use lofty::prelude::*;
use lofty::probe::Probe;
use rodio::{ChannelCount, Decoder, DeviceSinkBuilder, MixerDeviceSink, Player, SampleRate, Source};
use rodio::source::SeekError;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs::{self, File};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Track {
    id: String,
    path: String,
    title: String,
    artist: String,
    album: String,
    genre: String,
    duration_seconds: u64,
    duration: String,
    extension: String,
    tone: String,
    artwork_path: Option<String>,
    waveform: Vec<f32>,
}

#[derive(Serialize)]
struct ScanResult {
    folder: String,
    tracks: Vec<Track>,
    skipped: usize,
}

#[derive(Serialize)]
struct BackendStatus {
    app: &'static str,
    version: &'static str,
    scanner: &'static str,
    playback: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioStatus {
    loaded: bool,
    playing: bool,
    empty: bool,
    position_seconds: f64,
    volume: f32,
    current_path: Option<String>,
    queued_sources: usize,
}

#[derive(Deserialize)]
struct ItunesSearchResponse {
    results: Vec<ItunesAlbumResult>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ItunesAlbumResult {
    collection_id: Option<u64>,
    collection_name: Option<String>,
    artist_name: Option<String>,
    primary_genre_name: Option<String>,
    release_date: Option<String>,
    artwork_url100: Option<String>,
    collection_view_url: Option<String>,
    track_count: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiscoverAlbum {
    id: String,
    title: String,
    artist: String,
    genre: String,
    release_date: String,
    artwork_url: String,
    store_url: String,
    track_count: u32,
}


#[derive(Clone, Copy)]
struct DspSettings {
    preamp_db: f32,
    bass_db: f32,
    mids_db: f32,
    treble_db: f32,
    normalization: bool,
}

#[derive(Clone, Copy, Default)]
struct BiquadState {
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

#[derive(Clone, Copy)]
struct BiquadCoeffs {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
}

impl BiquadCoeffs {
    fn identity() -> Self {
        Self { b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0 }
    }

    fn peaking(sample_rate: f32, freq: f32, q: f32, gain_db: f32) -> Self {
        if gain_db.abs() < 0.01 { return Self::identity(); }
        let a = 10.0_f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * freq.min(sample_rate * 0.45) / sample_rate;
        let alpha = w0.sin() / (2.0 * q);
        let cos_w0 = w0.cos();
        let b0 = 1.0 + alpha * a;
        let b1 = -2.0 * cos_w0;
        let b2 = 1.0 - alpha * a;
        let a0 = 1.0 + alpha / a;
        let a1 = -2.0 * cos_w0;
        let a2 = 1.0 - alpha / a;
        Self { b0:b0/a0, b1:b1/a0, b2:b2/a0, a1:a1/a0, a2:a2/a0 }
    }

    fn low_shelf(sample_rate: f32, freq: f32, gain_db: f32) -> Self {
        if gain_db.abs() < 0.01 { return Self::identity(); }
        let a = 10.0_f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * freq.min(sample_rate * 0.45) / sample_rate;
        let cs = w0.cos();
        let sn = w0.sin();
        let alpha = sn / 2.0 * 2.0_f32.sqrt();
        let beta = 2.0 * a.sqrt() * alpha;
        let b0 = a*((a+1.0)-(a-1.0)*cs+beta);
        let b1 = 2.0*a*((a-1.0)-(a+1.0)*cs);
        let b2 = a*((a+1.0)-(a-1.0)*cs-beta);
        let a0 = (a+1.0)+(a-1.0)*cs+beta;
        let a1 = -2.0*((a-1.0)+(a+1.0)*cs);
        let a2 = (a+1.0)+(a-1.0)*cs-beta;
        Self { b0:b0/a0, b1:b1/a0, b2:b2/a0, a1:a1/a0, a2:a2/a0 }
    }

    fn high_shelf(sample_rate: f32, freq: f32, gain_db: f32) -> Self {
        if gain_db.abs() < 0.01 { return Self::identity(); }
        let a = 10.0_f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * freq.min(sample_rate * 0.45) / sample_rate;
        let cs = w0.cos();
        let sn = w0.sin();
        let alpha = sn / 2.0 * 2.0_f32.sqrt();
        let beta = 2.0 * a.sqrt() * alpha;
        let b0 = a*((a+1.0)+(a-1.0)*cs+beta);
        let b1 = -2.0*a*((a-1.0)+(a+1.0)*cs);
        let b2 = a*((a+1.0)+(a-1.0)*cs-beta);
        let a0 = (a+1.0)-(a-1.0)*cs+beta;
        let a1 = 2.0*((a-1.0)-(a+1.0)*cs);
        let a2 = (a+1.0)-(a-1.0)*cs-beta;
        Self { b0:b0/a0, b1:b1/a0, b2:b2/a0, a1:a1/a0, a2:a2/a0 }
    }

    fn process(&self, input: f32, state: &mut BiquadState) -> f32 {
        let out = self.b0*input + self.b1*state.x1 + self.b2*state.x2
            - self.a1*state.y1 - self.a2*state.y2;
        state.x2 = state.x1;
        state.x1 = input;
        state.y2 = state.y1;
        state.y1 = out;
        out
    }
}

struct EqSource<I>
where I: Source<Item=f32> {
    input: I,
    low: BiquadCoeffs,
    mid: BiquadCoeffs,
    high: BiquadCoeffs,
    low_state: Vec<BiquadState>,
    mid_state: Vec<BiquadState>,
    high_state: Vec<BiquadState>,
    channel_index: usize,
    preamp: f32,
    normalize_gain: f32,
}

impl<I> EqSource<I>
where I: Source<Item=f32> {
    fn new(input: I, settings: DspSettings) -> Self {
        let channels = input.channels().get() as usize;
        let sr = input.sample_rate().get() as f32;
        Self {
            low: BiquadCoeffs::low_shelf(sr, 120.0, settings.bass_db),
            mid: BiquadCoeffs::peaking(sr, 1000.0, 0.8, settings.mids_db),
            high: BiquadCoeffs::high_shelf(sr, 7000.0, settings.treble_db),
            low_state: vec![BiquadState::default(); channels],
            mid_state: vec![BiquadState::default(); channels],
            high_state: vec![BiquadState::default(); channels],
            channel_index: 0,
            preamp: 10.0_f32.powf(settings.preamp_db / 20.0),
            // This is deliberately conservative, not mislabeled ReplayGain.
            normalize_gain: if settings.normalization { 0.82 } else { 1.0 },
            input,
        }
    }

    fn reset_filter_state(&mut self) {
        self.low_state.fill(BiquadState::default());
        self.mid_state.fill(BiquadState::default());
        self.high_state.fill(BiquadState::default());
        self.channel_index = 0;
    }
}

impl<I> Iterator for EqSource<I>
where I: Source<Item=f32> {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        let sample = self.input.next()?;
        let ch = self.channel_index;
        let mut x = sample * self.preamp * self.normalize_gain;
        x = self.low.process(x, &mut self.low_state[ch]);
        x = self.mid.process(x, &mut self.mid_state[ch]);
        x = self.high.process(x, &mut self.high_state[ch]);

        self.channel_index += 1;
        if self.channel_index >= self.low_state.len() { self.channel_index = 0; }

        // Smooth safety limiter. It prevents boosted EQ bands from exploding/clipping.
        Some((x * 0.94).tanh() / 0.94_f32.tanh())
    }

    fn size_hint(&self) -> (usize, Option<usize>) { self.input.size_hint() }
}

impl<I> Source for EqSource<I>
where I: Source<Item=f32> {
    fn current_span_len(&self) -> Option<usize> { self.input.current_span_len() }
    fn channels(&self) -> ChannelCount { self.input.channels() }
    fn sample_rate(&self) -> SampleRate { self.input.sample_rate() }
    fn total_duration(&self) -> Option<Duration> { self.input.total_duration() }
    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        self.input.try_seek(pos)?;
        self.reset_filter_state();
        Ok(())
    }
}

#[derive(Default)]
struct AudioEngine {
    device: Option<MixerDeviceSink>,
    player: Option<Player>,
    outgoing_player: Option<Player>,
    current_path: Option<String>,
    pending_path: Option<String>,
    normalization: bool,
    preamp_db: f32,
    bass_db: f32,
    mids_db: f32,
    treble_db: f32,
    user_volume: f32,
    transition_id: u64,
}

impl AudioEngine {
    fn safe_output_volume(&self, user_volume: f32) -> f32 {
        // Player::set_volume is linear gain. A raw 1.0 was far too aggressive
        // for Reson, so 100% in the UI tops out at 0.55 and uses a perceptual curve.
        0.55 * user_volume.clamp(0.0, 1.0).powf(1.8)
    }

    fn dsp_settings(&self) -> DspSettings {
        DspSettings {
            preamp_db: self.preamp_db,
            bass_db: self.bass_db,
            mids_db: self.mids_db,
            treble_db: self.treble_db,
            normalization: self.normalization,
        }
    }

    fn ensure_ready(&mut self) -> Result<(), String> {
        if self.device.is_none() {
            let device = DeviceSinkBuilder::open_default_sink()
                .map_err(|e| format!("Could not open the default audio device: {e}"))?;
            self.device = Some(device);
        }
        if self.player.is_none() {
            let mixer = self.device.as_ref().expect("audio device exists").mixer();
            self.player = Some(Player::connect_new(mixer));
        }
        Ok(())
    }
}

#[tauri::command]
fn backend_status() -> BackendStatus {
    BackendStatus {
        app: "Reson",
        version: env!("CARGO_PKG_VERSION"),
        scanner: "lofty",
        playback: "rodio",
    }
}

#[tauri::command]
fn scan_music_folder(folder: String) -> Result<ScanResult, String> {
    let root = PathBuf::from(&folder);
    if !root.is_dir() {
        return Err("The selected path is not a folder.".into());
    }

    let artwork_cache = std::env::temp_dir().join("reson-artwork");
    let waveform_cache = std::env::temp_dir().join("reson-waveforms");
    let _ = fs::create_dir_all(&artwork_cache);
    let _ = fs::create_dir_all(&waveform_cache);

    let mut paths = Vec::new();
    collect_audio_files(&root, &mut paths).map_err(|e| e.to_string())?;
    paths.sort_by_key(|p| p.to_string_lossy().to_lowercase());

    let mut tracks = Vec::new();
    let mut skipped = 0usize;
    for path in paths {
        match read_track(&path, &artwork_cache, &waveform_cache) {
            Ok(track) => tracks.push(track),
            Err(_) => skipped += 1,
        }
    }

    tracks.sort_by(|a, b| {
        a.artist
            .to_lowercase()
            .cmp(&b.artist.to_lowercase())
            .then_with(|| a.album.to_lowercase().cmp(&b.album.to_lowercase()))
            .then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase()))
    });

    Ok(ScanResult {
        folder: root.to_string_lossy().to_string(),
        tracks,
        skipped,
    })
}



#[tauri::command]
async fn get_track_waveform(path: String) -> Result<Vec<f32>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let audio_path = PathBuf::from(&path);
        if !audio_path.is_file() {
            return Err("Waveform source file could not be found.".to_string());
        }

        let mut hasher = DefaultHasher::new();
        audio_path.hash(&mut hasher);
        let hash = hasher.finish();

        let waveform_cache = std::env::temp_dir().join("reson-waveforms");
        let _ = fs::create_dir_all(&waveform_cache);

        build_and_cache_waveform(&audio_path, &waveform_cache, hash)
    })
    .await
    .map_err(|e| format!("Waveform worker failed: {e}"))?
}

#[tauri::command]
async fn discover_search(term: String, limit: u32) -> Result<Vec<DiscoverAlbum>, String> {
    let query = term.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let limit = limit.clamp(1, 25);
    let client = reqwest::Client::builder()
        .user_agent("Reson/0.13.1 local music player")
        .build()
        .map_err(|e| format!("Could not create catalog client: {e}"))?;
    let limit_string = limit.to_string();
    let response = client
        .get("https://itunes.apple.com/search")
        .query(&[("term", query), ("media", "music"), ("entity", "album"), ("country", "US"), ("limit", limit_string.as_str())])
        .send()
        .await
        .map_err(|e| format!("Catalog request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Catalog returned an error: {e}"))?
        .json::<ItunesSearchResponse>()
        .await
        .map_err(|e| format!("Could not read catalog response: {e}"))?;

    let mut albums = Vec::new();
    for item in response.results {
        let Some(id) = item.collection_id else { continue };
        let Some(title) = item.collection_name.filter(|v| !v.trim().is_empty()) else { continue };
        let artist = item.artist_name.unwrap_or_else(|| "Unknown Artist".into());
        let artwork_url = item.artwork_url100.unwrap_or_default().replace("100x100bb", "600x600bb");
        albums.push(DiscoverAlbum {
            id: id.to_string(),
            title,
            artist,
            genre: item.primary_genre_name.unwrap_or_else(|| "Music".into()),
            release_date: item.release_date.unwrap_or_default(),
            artwork_url,
            store_url: item.collection_view_url.unwrap_or_default(),
            track_count: item.track_count.unwrap_or(0),
        });
    }
    Ok(albums)
}

#[tauri::command]
fn audio_play_file(
    path: String,
    volume: f32,
    state: tauri::State<'_, Arc<Mutex<AudioEngine>>>,
) -> Result<(), String> {
    let file = File::open(&path).map_err(|e| format!("Could not open audio file: {e}"))?;
    let source = Decoder::try_from(file).map_err(|e| format!("Could not decode audio file: {e}"))?;

    let mut engine = state.lock().map_err(|_| "Audio engine lock failed".to_string())?;
    engine.ensure_ready()?;
    engine.transition_id = engine.transition_id.wrapping_add(1);
    if let Some(outgoing) = engine.outgoing_player.take() { outgoing.stop(); }
    engine.pending_path = None;
    engine.user_volume = volume.clamp(0.0, 1.0);
    let settings = engine.dsp_settings();
    let output_volume = engine.safe_output_volume(engine.user_volume);
    let filtered = EqSource::new(source, settings);
    let player = engine.player.as_ref().expect("player exists");
    player.clear();
    player.append(filtered);
    player.set_volume(output_volume);
    player.play();
    engine.current_path = Some(path);
    Ok(())
}


#[tauri::command]
fn audio_crossfade_to(
    path: String,
    volume: f32,
    duration_seconds: f32,
    state: tauri::State<'_, Arc<Mutex<AudioEngine>>>,
) -> Result<(), String> {
    let file = File::open(&path).map_err(|e| format!("Could not open crossfade track: {e}"))?;
    let source = Decoder::try_from(file).map_err(|e| format!("Could not decode crossfade track: {e}"))?;

    let shared = Arc::clone(state.inner());
    let (transition_id, duration) = {
        let mut engine = shared.lock().map_err(|_| "Audio engine lock failed".to_string())?;
        engine.ensure_ready()?;
        engine.transition_id = engine.transition_id.wrapping_add(1);
        let id = engine.transition_id;
        engine.pending_path = None;
        engine.user_volume = volume.clamp(0.0, 1.0);

        let settings = engine.dsp_settings();
        let filtered = EqSource::new(source, settings);
        let incoming = {
            let mixer = engine.device.as_ref().expect("audio device exists").mixer();
            Player::connect_new(mixer)
        };
        incoming.append(filtered);
        incoming.set_volume(0.0);
        incoming.play();

        if let Some(old_outgoing) = engine.outgoing_player.take() {
            old_outgoing.stop();
        }
        engine.outgoing_player = engine.player.take();
        engine.player = Some(incoming);
        engine.current_path = Some(path);
        (id, duration_seconds.clamp(0.1, 12.0))
    };

    std::thread::spawn(move || {
        let steps = ((duration * 40.0).round() as u32).max(4);
        let sleep = Duration::from_secs_f32(duration / steps as f32);
        for step in 0..=steps {
            let progress = step as f32 / steps as f32;
            let Ok(engine) = shared.lock() else { return; };
            if engine.transition_id != transition_id { return; }
            let output_volume = engine.safe_output_volume(engine.user_volume);
            if let Some(incoming) = engine.player.as_ref() {
                incoming.set_volume(output_volume * progress);
            }
            if let Some(outgoing) = engine.outgoing_player.as_ref() {
                outgoing.set_volume(output_volume * (1.0 - progress));
            }
            drop(engine);
            if step < steps { std::thread::sleep(sleep); }
        }
        if let Ok(mut engine) = shared.lock() {
            if engine.transition_id == transition_id {
                if let Some(outgoing) = engine.outgoing_player.take() { outgoing.stop(); }
                let output_volume = engine.safe_output_volume(engine.user_volume);
                if let Some(incoming) = engine.player.as_ref() { incoming.set_volume(output_volume); }
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn audio_queue_next(
    path: String,
    state: tauri::State<'_, Arc<Mutex<AudioEngine>>>,
) -> Result<(), String> {
    let file = File::open(&path).map_err(|e| format!("Could not open queued track: {e}"))?;
    let source = Decoder::try_from(file).map_err(|e| format!("Could not decode queued track: {e}"))?;

    let mut engine = state.lock().map_err(|_| "Audio engine lock failed".to_string())?;
    engine.ensure_ready()?;
    let settings = engine.dsp_settings();
    let filtered = EqSource::new(source, settings);
    let player = engine.player.as_ref().expect("player exists");

    // Keep at most one native pending source. If one is already armed, leave it alone;
    // replacing it with skip_one() would skip the currently playing song.
    if engine.pending_path.is_some() || player.len() > 1 {
        return Ok(());
    }
    player.append(filtered);
    engine.pending_path = Some(path);
    Ok(())
}

#[tauri::command]
fn audio_pause(state: tauri::State<'_, Arc<Mutex<AudioEngine>>>) -> Result<(), String> {
    let engine = state.lock().map_err(|_| "Audio engine lock failed".to_string())?;
    if let Some(player) = engine.player.as_ref() { player.pause(); }
    if let Some(player) = engine.outgoing_player.as_ref() { player.pause(); }
    Ok(())
}

#[tauri::command]
fn audio_resume(state: tauri::State<'_, Arc<Mutex<AudioEngine>>>) -> Result<(), String> {
    let engine = state.lock().map_err(|_| "Audio engine lock failed".to_string())?;
    if let Some(player) = engine.player.as_ref() { player.play(); }
    if let Some(player) = engine.outgoing_player.as_ref() { player.play(); }
    Ok(())
}

#[tauri::command]
fn audio_seek(seconds: f64, state: tauri::State<'_, Arc<Mutex<AudioEngine>>>) -> Result<(), String> {
    let mut engine = state.lock().map_err(|_| "Audio engine lock failed".to_string())?;
    engine.transition_id = engine.transition_id.wrapping_add(1);
    if let Some(outgoing) = engine.outgoing_player.take() { outgoing.stop(); }

    let target = Duration::from_secs_f64(seconds.max(0.0));
    if engine.pending_path.is_some() {
        let Some(path) = engine.current_path.clone() else { return Ok(()); };
        let file = File::open(&path).map_err(|e| format!("Could not reopen audio file while seeking: {e}"))?;
        let source = Decoder::try_from(file).map_err(|e| format!("Could not decode audio file while seeking: {e}"))?;
        let filtered = EqSource::new(source, engine.dsp_settings());
        let output = engine.safe_output_volume(engine.user_volume);
        let was_paused = engine.player.as_ref().map(|p| p.is_paused()).unwrap_or(false);
        let player = engine.player.as_ref().expect("player exists");
        player.clear();
        player.append(filtered);
        player.set_volume(output);
        player.try_seek(target).map_err(|e| format!("Could not seek: {e}"))?;
        if was_paused { player.pause(); } else { player.play(); }
        engine.pending_path = None;
    } else if let Some(player) = engine.player.as_ref() {
        player.try_seek(target).map_err(|e| format!("Could not seek: {e}"))?;
    }
    Ok(())
}


#[tauri::command]
fn audio_stop(state: tauri::State<'_, Arc<Mutex<AudioEngine>>>) -> Result<(), String> {
    let mut engine = state.lock().map_err(|_| "Audio engine lock failed".to_string())?;
    engine.transition_id = engine.transition_id.wrapping_add(1);
    if let Some(player) = engine.player.as_ref() { player.stop(); }
    if let Some(outgoing) = engine.outgoing_player.take() { outgoing.stop(); }
    engine.pending_path = None;
    engine.current_path = None;
    Ok(())
}

#[tauri::command]
fn audio_set_volume(volume: f32, state: tauri::State<'_, Arc<Mutex<AudioEngine>>>) -> Result<(), String> {
    let mut engine = state.lock().map_err(|_| "Audio engine lock failed".to_string())?;
    engine.user_volume = volume.clamp(0.0, 1.0);
    let output = engine.safe_output_volume(engine.user_volume);
    if let Some(player) = engine.player.as_ref() { player.set_volume(output); }
    if engine.outgoing_player.is_none() {
        // No transition is active; normal single-player volume.
    }
    Ok(())
}

#[tauri::command]
fn audio_configure(normalization: bool, preamp_db: f32, bass_db: f32, mids_db: f32, treble_db: f32, state: tauri::State<'_, Arc<Mutex<AudioEngine>>>) -> Result<(), String> {
    let mut engine = state.lock().map_err(|_| "Audio engine lock failed".to_string())?;
    engine.normalization = normalization;
    engine.preamp_db = preamp_db.clamp(-12.0, 12.0);
    engine.bass_db = bass_db.clamp(-12.0, 12.0);
    engine.mids_db = mids_db.clamp(-12.0, 12.0);
    engine.treble_db = treble_db.clamp(-12.0, 12.0);
    engine.transition_id = engine.transition_id.wrapping_add(1);
    if let Some(outgoing) = engine.outgoing_player.take() { outgoing.stop(); }
    engine.pending_path = None;

    // Rebuild the current stream at the same position so EQ changes are audible immediately.
    let Some(path) = engine.current_path.clone() else { return Ok(()); };
    let Some(player) = engine.player.as_ref() else { return Ok(()); };
    let pos = player.get_pos();
    let was_paused = player.is_paused();

    let file = File::open(&path).map_err(|e| format!("Could not reopen audio file for EQ: {e}"))?;
    let source = Decoder::try_from(file).map_err(|e| format!("Could not decode audio file for EQ: {e}"))?;
    let filtered = EqSource::new(source, engine.dsp_settings());
    let output = engine.safe_output_volume(engine.user_volume);

    let player = engine.player.as_ref().expect("player exists");
    player.clear();
    player.append(filtered);
    player.set_volume(output);
    if pos > Duration::from_millis(0) {
        let _ = player.try_seek(pos);
    }
    if was_paused { player.pause(); } else { player.play(); }
    Ok(())
}

#[tauri::command]
fn audio_status(state: tauri::State<'_, Arc<Mutex<AudioEngine>>>) -> Result<AudioStatus, String> {
    let mut engine = state.lock().map_err(|_| "Audio engine lock failed".to_string())?;

    // For gapless playback, Player keeps both sources in one native queue. Once
    // the first source has finished, len() drops to one and we promote pending_path.
    let queued_sources = engine.player.as_ref().map(|p| p.len()).unwrap_or(0);
    if engine.pending_path.is_some() && queued_sources == 1 {
        engine.current_path = engine.pending_path.take();
    }

    if let Some(player) = engine.player.as_ref() {
        Ok(AudioStatus {
            loaded: engine.current_path.is_some(),
            playing: !player.is_paused() && !player.empty(),
            empty: player.empty(),
            position_seconds: player.get_pos().as_secs_f64(),
            volume: player.volume(),
            current_path: engine.current_path.clone(),
            queued_sources: player.len(),
        })
    } else {
        Ok(AudioStatus {
            loaded: false,
            playing: false,
            empty: true,
            position_seconds: 0.0,
            volume: 0.0,
            current_path: None,
            queued_sources: 0,
        })
    }
}

fn collect_audio_files(dir: &Path, output: &mut Vec<PathBuf>) -> std::io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            if !entry.file_name().to_string_lossy().starts_with('.') {
                collect_audio_files(&path, output)?;
            }
        } else if is_audio_file(&path) {
            output.push(path);
        }
    }
    Ok(())
}

fn is_audio_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|x| x.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "mp3" | "flac" | "wav" | "ogg" | "m4a" | "aac" | "opus" | "aiff" | "aif"
    )
}

fn read_track(path: &Path, artwork_cache: &Path, waveform_cache: &Path) -> Result<Track, String> {
    let tagged = Probe::open(path)
        .map_err(|e| e.to_string())?
        .read()
        .map_err(|e| e.to_string())?;
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
    let fallback_title = path
        .file_stem()
        .and_then(|x| x.to_str())
        .unwrap_or("Unknown Track");
    let title = tag
        .and_then(|t| t.title().map(|v| v.into_owned()))
        .filter(|x| !x.trim().is_empty())
        .unwrap_or_else(|| fallback_title.to_string());
    let artist = tag
        .and_then(|t| t.artist().map(|v| v.into_owned()))
        .filter(|x| !x.trim().is_empty())
        .unwrap_or_else(|| "Unknown Artist".into());
    let album = tag
        .and_then(|t| t.album().map(|v| v.into_owned()))
        .filter(|x| !x.trim().is_empty())
        .unwrap_or_else(|| "Unknown Album".into());
    let genre = tag
        .and_then(|t| t.genre().map(|v| v.into_owned()))
        .filter(|x| !x.trim().is_empty())
        .unwrap_or_else(|| "Unknown Genre".into());
    let seconds = tagged.properties().duration().as_secs();
    let extension = path
        .extension()
        .and_then(|x| x.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    let hash = hasher.finish();
    let tones = ["violet", "magenta", "blue", "midnight", "rose", "teal", "red"];
    let tone = tones[(hash as usize) % tones.len()].to_string();

    let artwork_path = extract_artwork(path, tag, artwork_cache, &artist, &album);
    let waveform = load_cached_waveform(waveform_cache, hash);

    Ok(Track {
        id: format!("{:x}", hash),
        path: path.to_string_lossy().to_string(),
        title,
        artist,
        album,
        genre,
        duration_seconds: seconds,
        duration: format!("{}:{:02}", seconds / 60, seconds % 60),
        extension,
        tone,
        artwork_path,
        waveform,
    })
}


fn load_cached_waveform(cache: &Path, hash: u64) -> Vec<f32> {
    const BINS: usize = 96;
    let target = cache.join(format!("{:x}.wave", hash));
    if let Ok(text) = fs::read_to_string(&target) {
        let values: Vec<f32> = text
            .split(',')
            .filter_map(|value| value.parse::<f32>().ok())
            .collect();
        if values.len() == BINS {
            return values;
        }
    }
    Vec::new()
}

fn build_and_cache_waveform(audio_path: &Path, cache: &Path, hash: u64) -> Result<Vec<f32>, String> {
    const BINS: usize = 96;
    let existing = load_cached_waveform(cache, hash);
    if existing.len() == BINS {
        return Ok(existing);
    }
    let values = build_waveform(audio_path, BINS)
        .ok_or_else(|| "Could not analyze waveform for this track.".to_string())?;
    let target = cache.join(format!("{:x}.wave", hash));
    let encoded = values
        .iter()
        .map(|value| format!("{:.4}", value))
        .collect::<Vec<_>>()
        .join(",");
    let _ = fs::write(target, encoded);
    Ok(values)
}

fn build_waveform(audio_path: &Path, bins: usize) -> Option<Vec<f32>> {
    let file = File::open(audio_path).ok()?;
    let decoder = Decoder::try_from(file).ok()?;
    let channels = decoder.channels().get() as usize;
    let sample_rate = decoder.sample_rate().get() as usize;
    let duration = decoder.total_duration()?;
    let estimated_samples =
        ((duration.as_secs_f64() * sample_rate as f64 * channels as f64).ceil() as usize).max(bins);
    let samples_per_bin = (estimated_samples / bins).max(1);

    let mut peaks = vec![0.0_f32; bins];
    let mut sums = vec![0.0_f64; bins];
    let mut counts = vec![0usize; bins];

    for (index, sample) in decoder.enumerate() {
        let bin = (index / samples_per_bin).min(bins - 1);
        let amplitude = sample.abs().min(1.0);
        peaks[bin] = peaks[bin].max(amplitude);
        sums[bin] += (amplitude as f64) * (amplitude as f64);
        counts[bin] += 1;
    }

    let mut values = Vec::with_capacity(bins);
    for index in 0..bins {
        let rms = if counts[index] > 0 {
            (sums[index] / counts[index] as f64).sqrt() as f32
        } else {
            0.0
        };
        // Blend RMS and peak so quiet detail remains visible without letting
        // isolated transients dominate the entire shape.
        values.push((rms * 0.72 + peaks[index] * 0.28).max(0.015));
    }

    let max_value = values.iter().copied().fold(0.0_f32, f32::max).max(0.001);
    for value in &mut values {
        *value = ((*value / max_value).powf(0.72) * 0.94 + 0.06).clamp(0.06, 1.0);
    }
    Some(values)
}

fn extract_artwork(
    audio_path: &Path,
    tag: Option<&lofty::tag::Tag>,
    cache: &Path,
    artist: &str,
    album: &str,
) -> Option<String> {
    let mut album_hasher = DefaultHasher::new();
    artist.to_lowercase().hash(&mut album_hasher);
    album.to_lowercase().hash(&mut album_hasher);
    let album_hash = album_hasher.finish();

    if let Some(tag) = tag {
        if let Some(picture) = tag.pictures().first() {
            let ext = image_extension(picture.data());
            let target = cache.join(format!("{:x}.{}", album_hash, ext));
            if !target.exists() {
                if fs::write(&target, picture.data()).is_err() {
                    return None;
                }
            }
            return Some(target.to_string_lossy().to_string());
        }
    }

    let parent = audio_path.parent()?;
    for name in [
        "cover.jpg", "cover.jpeg", "cover.png", "folder.jpg", "folder.jpeg", "folder.png",
        "front.jpg", "front.jpeg", "front.png", "album.jpg", "album.png",
    ] {
        let candidate = parent.join(name);
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    None
}

fn image_extension(data: &[u8]) -> &'static str {
    if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        "png"
    } else if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        "gif"
    } else if data.starts_with(b"RIFF") && data.get(8..12) == Some(&b"WEBP"[..]) {
        "webp"
    } else {
        "jpg"
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(Mutex::new(AudioEngine::default())))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED
                        | tauri_plugin_window_state::StateFlags::FULLSCREEN,
                )
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            backend_status,
            scan_music_folder,
            get_track_waveform,
            discover_search,
            audio_play_file,
            audio_crossfade_to,
            audio_queue_next,
            audio_pause,
            audio_resume,
            audio_seek,
            audio_stop,
            audio_set_volume,
            audio_configure,
            audio_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running Reson");
}
