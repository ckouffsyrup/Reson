import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';

type View = 'home' | 'library' | 'playlists' | 'discover' | 'stats' | 'friends' | 'settings' | 'profile';
type LibraryView = 'overview' | 'liked' | 'albums' | 'artists' | 'songs';

type Track = {
  id: string;
  path: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  durationSeconds: number;
  duration: string;
  extension: string;
  tone: string;
  artworkPath?: string | null;
  waveform?: number[];
};

type ScanResult = { folder: string; tracks: Track[]; skipped: number };
type AudioStatus = { loaded: boolean; playing: boolean; empty: boolean; positionSeconds: number; volume: number; currentPath?: string | null; queuedSources?: number };
type Playlist = { id: string; name: string; trackIds: string[]; createdAt: number; coverPath?: string };
type HistoryEntry = { trackId: string; playedAt: number };
type PlayCounts = Record<string, number>;
type SocialUser = {
  id:number;
  username:string;
  displayName:string;
  bio:string;
  avatarUrl:string;
  bannerUrl:string;
  totalListenSeconds:number;
  weeklyListenSeconds:number;
  songsInLibrary:number;
  likedSongs:number;
  playlists:number;
  topArtist:string;
  status:'online'|'idle'|'offline'|null;
  trackTitle:string;
  trackArtist:string;
  trackAlbum:string;
  isPlaying:number|boolean;
  presenceUpdatedAt:number|null;
};
type FriendRequest = {id:number;createdAt:number;username:string;displayName:string;avatarUrl:string};
type LeaderboardEntry = {rank:number;user:SocialUser};
type ResonAccountBackup = {
  profile:{name:string;bio:string;picture:string;banner:string;avatarCrop:ImageCrop;bannerCrop:ImageCrop;showcase:Array<ShowcaseItem & {valueType?:'trackRef'}>};
  library:{liked:string[];playCounts:Array<[string,number]>;history:Array<{ref:string;playedAt:number}>;playlists:Array<{id:string;name:string;createdAt:number;coverPath?:string;trackRefs:string[]}>};
  stats:{totalListenSeconds:number;dailyListenSeconds:DailyListenSeconds;weeklyRecaps:WeeklyRecap[]};
  preferences:{volume:number;audioSettings:{crossfade:number;normalization:boolean;preamp:number;bass:number;mids:number;treble:number;gapless:boolean};librarySort:LibrarySort;nowPlayingMode:NowPlayingMode;appBackground:AppBackgroundSettings};
  createdAt:number;
};


type DailyListenSeconds = Record<string, number>;
type WeeklyRecap = {
  id: string;
  weekStart: string;
  weekEnd: string;
  totalSeconds: number;
  songStarts: number;
  uniqueTracks: number;
  topTrackId: string | null;
  topArtist: string;
  topAlbum: string;
  bestDay: string;
  bestDaySeconds: number;
};
type RepeatMode = 'off' | 'all' | 'one';
type NowPlayingMode = 'artwork' | 'ambient' | 'queue';
type DiscoverMode = 'forYou' | 'saved' | 'added';
type ProfileFavorites = {
  trackId: string;
  artist: string;
  album: string;
  playlistId: string;
};
type ShowcaseKind = 'track' | 'artist' | 'album' | 'playlist';
type ShowcaseItem = {
  id: string;
  kind: ShowcaseKind;
  value: string;
};
type ImageCrop = {
  x: number;
  y: number;
  zoom: number;
};
type CropEditorState = {
  kind: 'avatar' | 'banner';
  draft: ImageCrop;
};
type AppBackgroundSettings = {
  mode: 'default' | 'custom';
  path: string;
  blur: number;
  dim: number;
  textContrast: 'normal' | 'strong';
};
type LibrarySort = 'title' | 'artist' | 'album' | 'mostPlayed' | 'duration';
type NavigationSnapshot = {
  active: View;
  libraryView: LibraryView;
  detail: {type:'album'|'artist';name:string}|null;
  activePlaylistId: string|null;
};
type ResonNotice = {
  id: string;
  title: string;
  message: string;
  createdAt: number;
  read: boolean;
  kind: 'library'|'playback'|'system';
};
type PlaybackSession = {
  trackId: string | null;
  positionSeconds: number;
  queueIds: string[];
  shuffleOn: boolean;
  repeatMode: RepeatMode;
  active: View;
  libraryView: LibraryView;
  activePlaylistId: string | null;
  playbackContextIds?: string[];
  playbackContextPlaylistId?: string | null;
  savedAt: number;
};
type DiscoverAlbum = { id: string; title: string; artist: string; genre: string; releaseDate: string; artworkUrl: string; storeUrl: string; trackCount: number; };

type IconName =
  | 'home' | 'library' | 'playlist' | 'discover' | 'stats' | 'heart' | 'album'
  | 'artist' | 'song' | 'tag' | 'search' | 'bell' | 'chevronDown' | 'back'
  | 'forward' | 'plus' | 'shuffle' | 'previous' | 'play' | 'pause' | 'next'
  | 'repeat' | 'volume' | 'queue' | 'device' | 'expand' | 'activity' | 'clock'
  | 'folder' | 'refresh' | 'settings' | 'external';

const demoTracks: Track[] = [
  ['Afterglow','Velvet Circuit','Night Transit','Electronic',222,'mp3','violet'],
  ['Glass Cities','Noa Vale','Soft Static','Alternative',251,'mp3','magenta'],
  ['Northbound','Mira Lane','Passing Lights','Indie',206,'flac','blue'],
  ['Slow Signal','Hollow Youth','Receiver','Alternative',303,'wav','midnight'],
  ['Distant Rooms','Yori','Still Awake','Dream Pop',178,'mp3','rose'],
].map((x, i) => ({ id:`demo-${i}`, path:'', title:String(x[0]), artist:String(x[1]), album:String(x[2]), genre:String(x[3]), durationSeconds:Number(x[4]), duration:formatTime(Number(x[4])), extension:String(x[5]), tone:String(x[6]), artworkPath:null, waveform:[] }));

const mixes = [
  { title: 'Recently Added', description: 'Jump back into the newest music in your Reson library.', tone: 'mix-teal' },
  { title: 'Album Shuffle', description: 'A shuffled slice of albums already in your collection.', tone: 'mix-purple' },
  { title: 'Focus', description: 'Build a quiet queue from your local collection.', tone: 'mix-blue' },
  { title: 'Late Night', description: 'Your darker, slower tracks in one place.', tone: 'mix-night' },
  { title: 'Favorites', description: 'The songs you keep coming back to.', tone: 'mix-red' }
];

const navItems: Array<{ key: View; label: string; icon: IconName }> = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'library', label: 'Library', icon: 'library' },
  { key: 'playlists', label: 'Playlists', icon: 'playlist' },
  { key: 'discover', label: 'Discover', icon: 'discover' },
  { key: 'stats', label: 'Stats', icon: 'stats' },
  { key: 'friends', label: 'Friends', icon: 'artist' },
  { key: 'settings', label: 'Settings', icon: 'settings' }
];

const libraryItems: Array<{ key: LibraryView; label: string; icon: IconName }> = [
  { key: 'liked', label: 'Liked Songs', icon: 'heart' },
  { key: 'albums', label: 'Albums', icon: 'album' },
  { key: 'artists', label: 'Artists', icon: 'artist' },
  { key: 'songs', label: 'Songs', icon: 'song' }
];


function resonImageSrc(value:string){
  if(!value)return '';
  return /^(data:|blob:|https?:)/i.test(value)?value:convertFileSrc(value);
}
async function imageToPortableData(value:string){
  if(!value)return '';
  if(/^data:/i.test(value))return value;
  if(/^https?:/i.test(value))return value;
  try{
    const response=await fetch(resonImageSrc(value));
    if(!response.ok)return '';
    const blob=await response.blob();
    if(blob.size>4*1024*1024)return '';
    return await new Promise<string>((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result||''));
      reader.onerror=()=>reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }catch{return '';}
}
function normalizedTrackRef(track:Pick<Track,'title'|'artist'|'album'|'durationSeconds'>){
  const clean=(v:string)=>v.trim().toLowerCase().replace(/\s+/g,' ');
  return `${clean(track.title)}\u001f${clean(track.artist)}\u001f${clean(track.album)}\u001f${Math.round(track.durationSeconds)}`;
}

function App() {
  const loadedTrackId = useRef<string | null>(null);
  const advancingRef = useRef(false);
  const crossfadeRef = useRef(false);
  const gaplessQueuedRef = useRef<string | null>(null);
  const sessionReadyRef = useRef(false);
  const lastSessionSaveRef = useRef(0);
  const waveformRequestsRef = useRef<Set<string>>(new Set());
  const navigationBackRef = useRef<NavigationSnapshot[]>([]);
  const navigationForwardRef = useRef<NavigationSnapshot[]>([]);
  const lastNavigationRef = useRef<NavigationSnapshot | null>(null);
  const applyingNavigationRef = useRef(false);
  const [active, setActive] = useState<View>(() => {
    const saved=localStorage.getItem('reson.lastView') as View|null;
    return saved&&['home','library','playlists','discover','stats','friends','settings','profile'].includes(saved)?saved:'home';
  });
  const [libraryView, setLibraryView] = useState<LibraryView>(() => {
    const saved=localStorage.getItem('reson.lastLibraryView') as LibraryView|null;
    return saved&&['overview','liked','albums','artists','songs'].includes(saved)?saved:'overview';
  });
  const [detail, setDetail] = useState<{type:'album'|'artist';name:string}|null>(null);
  const [contextMenu, setContextMenu] = useState<{x:number;y:number;trackId:string}|null>(null);
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>([]);
  const [trackDetailsId, setTrackDetailsId] = useState<string|null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [folder, setFolder] = useState(localStorage.getItem('reson.musicFolder') ?? '');
  const [scanBusy, setScanBusy] = useState(false);
  const [scanMessage, setScanMessage] = useState('');
  const [lastScanMs, setLastScanMs] = useState<number|null>(()=>{const v=Number(localStorage.getItem('reson.lastScanMs'));return Number.isFinite(v)&&v>=0?v:null;});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [volume, setVolume] = useState(Number(localStorage.getItem('reson.volume') ?? 72));
  const [audioSettings, setAudioSettings] = useState(() => ({
    crossfade: Number(localStorage.getItem('reson.crossfade') ?? 0),
    normalization: localStorage.getItem('reson.normalization') === 'true',
    preamp: Number(localStorage.getItem('reson.preamp') ?? 0),
    bass: Number(localStorage.getItem('reson.eqBass') ?? 0),
    mids: Number(localStorage.getItem('reson.eqMids') ?? 0),
    treble: Number(localStorage.getItem('reson.eqTreble') ?? 0),
    gapless: localStorage.getItem('reson.gapless') !== 'false'
  }));
  const [query, setQuery] = useState('');
  const [librarySort, setLibrarySort] = useState<LibrarySort>(() => (localStorage.getItem('reson.librarySort') as LibrarySort) || 'title');
  const [likedIds, setLikedIds] = useState<string[]>(() => JSON.parse(localStorage.getItem('reson.liked') ?? '[]'));
  const [queueOpen, setQueueOpen] = useState(false);
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [nowPlayingMode, setNowPlayingMode] = useState<NowPlayingMode>(() => (localStorage.getItem('reson.nowPlayingMode') as NowPlayingMode) || 'artwork');
  const [queueIds, setQueueIds] = useState<string[]>([]);
  const [shuffleOn, setShuffleOn] = useState(localStorage.getItem('reson.shuffle') === 'true');
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(() => (localStorage.getItem('reson.repeatMode') as RepeatMode) || 'off');
  const [playlists, setPlaylists] = useState<Playlist[]>(() => JSON.parse(localStorage.getItem('reson.playlists') ?? '[]'));
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [playbackContextIds, setPlaybackContextIds] = useState<string[]>([]);
  const [playbackContextPlaylistId, setPlaybackContextPlaylistId] = useState<string|null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(() => JSON.parse(localStorage.getItem('reson.history') ?? '[]'));
  const [playCounts, setPlayCounts] = useState<PlayCounts>(() => JSON.parse(localStorage.getItem('reson.playCounts') ?? '{}'));
  const [totalListenSeconds, setTotalListenSeconds] = useState(() => Number(localStorage.getItem('reson.totalListenSeconds') ?? 0));
  const [dailyListenSeconds, setDailyListenSeconds] = useState<DailyListenSeconds>(() => {
    try { return JSON.parse(localStorage.getItem('reson.dailyListenSeconds') ?? '{}'); } catch { return {}; }
  });
  const [weeklyRecaps, setWeeklyRecaps] = useState<WeeklyRecap[]>(() => {
    try { return JSON.parse(localStorage.getItem('reson.weeklyRecaps') ?? '[]'); } catch { return []; }
  });
  const [addMusicOpen, setAddMusicOpen] = useState(false);
  const [profileName, setProfileName] = useState(() => localStorage.getItem('reson.profileName') || 'Reson Listener');
  const [profilePicture, setProfilePicture] = useState(() => localStorage.getItem('reson.profilePicture') || '');
  const [avatarCrop, setAvatarCrop] = useState<ImageCrop>(() => {
    try { return {...{x:50,y:50,zoom:1.04},...JSON.parse(localStorage.getItem('reson.avatarCrop') ?? '{}')}; }
    catch { return {x:50,y:50,zoom:1.04}; }
  });
  const [bannerCrop, setBannerCrop] = useState<ImageCrop>(() => {
    try { return {...{x:50,y:50,zoom:1},...JSON.parse(localStorage.getItem('reson.bannerCrop') ?? '{}')}; }
    catch { return {x:50,y:50,zoom:1}; }
  });
  const [cropEditor, setCropEditor] = useState<CropEditorState|null>(null);
  const [profileBanner, setProfileBanner] = useState(() => localStorage.getItem('reson.profileBanner') || '');
  const [profileBio, setProfileBio] = useState(() => localStorage.getItem('reson.profileBio') || '');
  const [profileFavorites, setProfileFavorites] = useState<ProfileFavorites>(() => {
    try { return JSON.parse(localStorage.getItem('reson.profileFavorites') ?? '{"trackId":"","artist":"","album":"","playlistId":""}'); }
    catch { return {trackId:'',artist:'',album:'',playlistId:''}; }
  });
  const [profileShowcase,setProfileShowcase]=useState<ShowcaseItem[]>(()=>{
    try{
      const saved=JSON.parse(localStorage.getItem('reson.profileShowcase')??'null');
      if(Array.isArray(saved))return saved.slice(0,6);
    }catch{}
    try{
      const legacy:ProfileFavorites=JSON.parse(localStorage.getItem('reson.profileFavorites')??'{"trackId":"","artist":"","album":"","playlistId":""}');
      return [
        legacy.trackId?{id:'showcase-track',kind:'track' as const,value:legacy.trackId}:null,
        legacy.artist?{id:'showcase-artist',kind:'artist' as const,value:legacy.artist}:null,
        legacy.album?{id:'showcase-album',kind:'album' as const,value:legacy.album}:null,
        legacy.playlistId?{id:'showcase-playlist',kind:'playlist' as const,value:legacy.playlistId}:null
      ].filter((item):item is ShowcaseItem=>!!item);
    }catch{return [];}
  });

  const [appBackground, setAppBackground] = useState<AppBackgroundSettings>(() => {
    try {
      return {...{mode:'default' as const,path:'',blur:16,dim:72,textContrast:'normal' as const}, ...JSON.parse(localStorage.getItem('reson.appBackground') ?? '{}')};
    } catch { return {mode:'default',path:'',blur:16,dim:72,textContrast:'normal'}; }
  });
  const [profileOpen, setProfileOpen] = useState(false);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const [notices, setNotices] = useState<ResonNotice[]>(() => {
    try { return JSON.parse(localStorage.getItem('reson.notices') ?? '[]'); } catch { return []; }
  });
  const [serverUrl,setServerUrl]=useState(()=>localStorage.getItem('reson.serverUrl')??'http://127.0.0.1:4782');
  const [socialToken,setSocialToken]=useState(()=>localStorage.getItem('reson.socialToken')??'');
  const [socialUser,setSocialUser]=useState<SocialUser|null>(null);
  const [socialFriends,setSocialFriends]=useState<SocialUser[]>([]);
  const [friendRequests,setFriendRequests]=useState<FriendRequest[]>([]);
  const [leaderboard,setLeaderboard]=useState<LeaderboardEntry[]>([]);
  const [leaderboardMetric,setLeaderboardMetric]=useState<'total'|'weekly'|'songs'>('total');
  const [socialStatus,setSocialStatus]=useState<'idle'|'connecting'|'online'|'offline'>('idle');
  const [socialMessage,setSocialMessage]=useState('');
  const [cloudBackupUpdatedAt,setCloudBackupUpdatedAt]=useState<number|null>(null);
  const [cloudSyncBusy,setCloudSyncBusy]=useState(false);


  const visibleTracks = tracks.length ? tracks : demoTracks;
  const current = visibleTracks[Math.min(currentIndex, visibleTracks.length - 1)] ?? demoTracks[0];
  const liked = !!current && likedIds.includes(current.id);
  const duration = current?.durationSeconds || 0;
  const progress = duration > 0 ? Math.min(100, (elapsedSeconds / duration) * 100) : 0;
  const profileInitials = profileName.split(/\s+/).filter(Boolean).map(part=>part[0]).join('').slice(0,2).toUpperCase() || 'R';
  const unreadNotices = notices.filter(notice=>!notice.read).length;

  const trackById = useMemo(() => new Map(tracks.map(track=>[track.id,track] as const)), [tracks]);

  const searchableTracks = useMemo(
    () => tracks.map(track=>({track,search:`${track.title}\n${track.artist}\n${track.album}\n${track.genre}`.toLowerCase()})),
    [tracks]
  );

  const filteredTracks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tracks;
    return searchableTracks.filter(item=>item.search.includes(q)).map(item=>item.track);
  }, [tracks, searchableTracks, query]);

  const queuedTracks = useMemo(() => queueIds.map(id=>trackById.get(id)).filter((track): track is Track => !!track), [queueIds, trackById]);
  const playbackPlaylist = playlists.find(playlist=>playlist.id===playbackContextPlaylistId) ?? null;

  useEffect(() => {
    if (!tracks.length || !current?.path) return;

    // Keep waveform samples only for the active song. The disk cache remains
    // available, but a 10k-song library no longer keeps thousands of 96-float
    // arrays alive in React state.
    if (tracks.some(track=>track.id!==current.id && track.waveform?.length)) {
      setTracks(items=>items.map(track=>track.id!==current.id&&track.waveform?.length?{...track,waveform:[]}:track));
    }

    if (current.waveform?.length || waveformRequestsRef.current.has(current.id)) return;
    waveformRequestsRef.current.add(current.id);

    let cancelled = false;
    void invoke<number[]>('get_track_waveform', { path: current.path })
      .then((waveform) => {
        if (cancelled || !waveform?.length) return;
        setTracks(items => items.map(track =>
          track.id === current.id
            ? {...track, waveform}
            : track.waveform?.length ? {...track, waveform:[]} : track
        ));
      })
      .catch(() => {
        // Waveform failure should never interfere with playback or startup.
      })
      .finally(() => {
        waveformRequestsRef.current.delete(current.id);
      });

    return () => { cancelled = true; };
  }, [current?.id, current?.path, current?.waveform?.length, tracks.length]);

  useEffect(() => {
    if (folder) void scanFolder(folder, false);
    else sessionReadyRef.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(()=>localStorage.setItem('reson.lastView',active),[active]);
  useEffect(()=>localStorage.setItem('reson.lastLibraryView',libraryView),[libraryView]);
  useEffect(()=>localStorage.setItem('reson.serverUrl',serverUrl.trim().replace(/\/+$/,'')),[serverUrl]);
  useEffect(()=>{if(socialToken)localStorage.setItem('reson.socialToken',socialToken);else localStorage.removeItem('reson.socialToken');},[socialToken]);
  useEffect(() => localStorage.setItem('reson.liked', JSON.stringify(likedIds)), [likedIds]);
  useEffect(() => localStorage.setItem('reson.playlists', JSON.stringify(playlists)), [playlists]);
  useEffect(() => localStorage.setItem('reson.history', JSON.stringify(history)), [history]);
  useEffect(() => localStorage.setItem('reson.playCounts', JSON.stringify(playCounts)), [playCounts]);
  useEffect(() => localStorage.setItem('reson.totalListenSeconds', String(totalListenSeconds)), [totalListenSeconds]);
  useEffect(() => localStorage.setItem('reson.dailyListenSeconds', JSON.stringify(dailyListenSeconds)), [dailyListenSeconds]);
  useEffect(() => localStorage.setItem('reson.weeklyRecaps', JSON.stringify(weeklyRecaps.slice(0,104))), [weeklyRecaps]);
  useEffect(() => localStorage.setItem('reson.profileName', profileName), [profileName]);
  useEffect(() => { if(profilePicture)localStorage.setItem('reson.profilePicture', profilePicture); else localStorage.removeItem('reson.profilePicture'); }, [profilePicture]);
  useEffect(() => localStorage.setItem('reson.avatarCrop',JSON.stringify(avatarCrop)), [avatarCrop]);
  useEffect(() => localStorage.setItem('reson.bannerCrop',JSON.stringify(bannerCrop)), [bannerCrop]);
  useEffect(() => { if(profileBanner)localStorage.setItem('reson.profileBanner',profileBanner); else localStorage.removeItem('reson.profileBanner'); }, [profileBanner]);
  useEffect(() => localStorage.setItem('reson.profileBio',profileBio), [profileBio]);
  useEffect(() => localStorage.setItem('reson.profileFavorites',JSON.stringify(profileFavorites)), [profileFavorites]);
  useEffect(()=>localStorage.setItem('reson.profileShowcase',JSON.stringify(profileShowcase.slice(0,6))),[profileShowcase]);
  useEffect(() => localStorage.setItem('reson.appBackground',JSON.stringify(appBackground)), [appBackground]);
  useEffect(() => localStorage.setItem('reson.notices', JSON.stringify(notices.slice(0,40))), [notices]);
  useEffect(() => {
    if (!tracks.length) return;
    const completed = previousCompletedWeek(new Date());
    if (weeklyRecaps.some(recap => recap.id === completed.startKey)) return;

    const dates = dateKeysBetween(completed.start, completed.end);
    const hasTrackedTime = dates.some(date => (dailyListenSeconds[date] ?? 0) > 0);
    const weekHistory = history.filter(entry => entry.playedAt >= completed.start.getTime() && entry.playedAt < completed.endExclusive.getTime());

    // Do not create an empty historical recap. v0.18 begins truthful daily tracking
    // from the moment it is installed.
    if (!hasTrackedTime && weekHistory.length === 0) return;

    const recap = makeWeeklyRecap(completed.start, completed.end, dailyListenSeconds, weekHistory, tracks);
    setWeeklyRecaps(items => [recap, ...items.filter(item => item.id !== recap.id)].slice(0,104));
    addNotice(
      'Your weekly recap is ready',
      `${formatListenTime(recap.totalSeconds)} listened · ${recap.uniqueTracks} unique track${recap.uniqueTracks===1?'':'s'} last week.`,
      'playback'
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks.length, history.length, dailyListenSeconds, weeklyRecaps.length]);

  useEffect(() => { localStorage.setItem('reson.crossfade', String(audioSettings.crossfade)); localStorage.setItem('reson.normalization', String(audioSettings.normalization)); localStorage.setItem('reson.preamp', String(audioSettings.preamp)); localStorage.setItem('reson.eqBass', String(audioSettings.bass)); localStorage.setItem('reson.eqMids', String(audioSettings.mids)); localStorage.setItem('reson.eqTreble', String(audioSettings.treble)); localStorage.setItem('reson.gapless', String(audioSettings.gapless)); void invoke('audio_configure', { normalization: audioSettings.normalization, preampDb: audioSettings.preamp, bassDb: audioSettings.bass, midsDb: audioSettings.mids, trebleDb: audioSettings.treble }).catch(()=>undefined); }, [audioSettings]);
  useEffect(() => localStorage.setItem('reson.shuffle', String(shuffleOn)), [shuffleOn]);
  useEffect(() => localStorage.setItem('reson.repeatMode', repeatMode), [repeatMode]);
  useEffect(() => localStorage.setItem('reson.nowPlayingMode', nowPlayingMode), [nowPlayingMode]);
  useEffect(() => localStorage.setItem('reson.librarySort', librarySort), [librarySort]);
  useEffect(() => {
    const snapshot: NavigationSnapshot = {active, libraryView, detail, activePlaylistId};
    const last = lastNavigationRef.current;
    const same = !!last && last.active===snapshot.active && last.libraryView===snapshot.libraryView &&
      last.activePlaylistId===snapshot.activePlaylistId &&
      last.detail?.type===snapshot.detail?.type && last.detail?.name===snapshot.detail?.name;
    if (same) return;

    if (!last) {
      lastNavigationRef.current = snapshot;
      return;
    }

    if (applyingNavigationRef.current) {
      applyingNavigationRef.current = false;
      lastNavigationRef.current = snapshot;
      return;
    }

    navigationBackRef.current.push(last);
    if (navigationBackRef.current.length > 60) navigationBackRef.current.shift();
    navigationForwardRef.current = [];
    lastNavigationRef.current = snapshot;
  }, [active, libraryView, detail, activePlaylistId]);

  useEffect(() => { savePlaybackSession(false); }, [elapsedSeconds]);
  useEffect(() => { savePlaybackSession(true); }, [queueIds, shuffleOn, repeatMode, active, libraryView, activePlaylistId, playbackContextIds, playbackContextPlaylistId, playing]);
  useEffect(() => {
    const beforeUnload = () => savePlaybackSession(true);
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, currentIndex, elapsedSeconds, queueIds, shuffleOn, repeatMode, active, libraryView, activePlaylistId, playbackContextIds, playbackContextPlaylistId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (event.ctrlKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('.search input')?.focus();
        return;
      }
      if (typing) return;
      if (event.key === 'Escape' && nowPlayingOpen) setNowPlayingOpen(false);
      if (nowPlayingOpen && event.key.toLowerCase() === 'a') setNowPlayingMode('artwork');
      if (nowPlayingOpen && event.key.toLowerCase() === 'v') setNowPlayingMode('ambient');
      if (nowPlayingOpen && event.key.toLowerCase() === 'q') setNowPlayingMode('queue');
      if (event.code === 'Space') { event.preventDefault(); void togglePlayback(); }
      if (event.key === 'ArrowRight') { event.preventDefault(); void seek(Math.min(100, progress + (duration ? 500 / duration : 0))); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); void seek(Math.max(0, progress - (duration ? 500 / duration : 0))); }
      if (event.key.toLowerCase() === 'm') setVolume(v => v === 0 ? Number(localStorage.getItem('reson.lastAudibleVolume') ?? 55) : (localStorage.setItem('reson.lastAudibleVolume', String(v)), 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowPlayingOpen, progress, duration]);


  useEffect(() => {
    if (!playing || !loadedTrackId.current) return;
    const timer = window.setInterval(() => {
      const day = localDateKey(new Date());
      setTotalListenSeconds(seconds => seconds + 1);
      setDailyListenSeconds(days => ({...days,[day]:(days[day]??0)+1}));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [playing]);

  useEffect(() => {
    localStorage.setItem('reson.volume', String(volume));
    void invoke('audio_set_volume', { volume: volume / 100 }).catch(() => undefined);
  }, [volume]);

  useEffect(() => {
    if (!tracks.length) return;
    const timer = window.setInterval(async () => {
      try {
        const status = await invoke<AudioStatus>('audio_status');

        // Native gapless queue transition: when Rodio moves into the appended source,
        // currentPath changes without an audible stop.
        if (status.currentPath && loadedTrackId.current) {
          const loadedTrack = tracks.find((track) => track.id === loadedTrackId.current);
          if (loadedTrack && status.currentPath !== loadedTrack.path) {
            const transitioned = tracks.find((track) => track.path === status.currentPath);
            if (transitioned) {
              const index = tracks.findIndex((track) => track.id === transitioned.id);
              if (index >= 0) setCurrentIndex(index);
              loadedTrackId.current = transitioned.id;
              setQueueIds((ids) => ids[0] === transitioned.id ? ids.slice(1) : ids.filter((id) => id !== transitioned.id));
              gaplessQueuedRef.current = null;
              setElapsedSeconds(status.positionSeconds);
              recordStartedTrack(transitioned);
            }
          }
        }

        setElapsedSeconds(status.positionSeconds);
        if (loadedTrackId.current) setPlaying(status.playing);

        const activeTrack = loadedTrackId.current ? tracks.find((track) => track.id === loadedTrackId.current) : null;
        const remaining = activeTrack ? Math.max(0, activeTrack.durationSeconds - status.positionSeconds) : Infinity;
        const next = queuedTracks[0];

        if (
          activeTrack &&
          next &&
          repeatMode !== 'one' &&
          status.playing &&
          !crossfadeRef.current
        ) {
          if (audioSettings.crossfade > 0 && remaining <= audioSettings.crossfade && remaining > 0.05) {
            void beginCrossfadeTo(next, queueIds.slice(1));
          } else if (
            audioSettings.crossfade <= 0 &&
            audioSettings.gapless &&
            remaining <= 1.5 &&
            remaining > 0.05 &&
            gaplessQueuedRef.current !== next.id
          ) {
            void armGaplessNext(next);
          }
        }

        if (loadedTrackId.current && status.empty && !advancingRef.current && !crossfadeRef.current) {
          advancingRef.current = true;
          await handleTrackEnded();
          window.setTimeout(() => { advancingRef.current = false; }, 400);
        }
      } catch {
        // Native audio may not have been initialized yet.
      }
    }, 180);
    return () => window.clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, currentIndex, volume, repeatMode, queueIds, shuffleOn, audioSettings.crossfade, audioSettings.gapless]);


  const chooseFolder = async () => {
    const selected = await open({ directory: true, multiple: false, title: 'Choose your music folder' });
    if (typeof selected === 'string') await scanFolder(selected, true);
  };

  const openSpotiSaver = async () => {
    try {
      await openUrl('https://spotisaver.net/en');
      setAddMusicOpen(false);
    } catch (error) {
      setScanMessage(`Could not open the external helper: ${String(error)}`);
    }
  };

  const addNotice = (title:string,message:string,kind:ResonNotice['kind']='system') => {
    const notice: ResonNotice = {id:`notice-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,title,message,createdAt:Date.now(),read:false,kind};
    setNotices(items => [notice,...items].slice(0,40));
  };

  const applyNavigation = (snapshot:NavigationSnapshot) => {
    applyingNavigationRef.current = true;
    setActive(snapshot.active);
    setLibraryView(snapshot.libraryView);
    setDetail(snapshot.detail);
    setActivePlaylistId(snapshot.activePlaylistId);
    setProfileOpen(false);
    setNoticesOpen(false);
  };

  const goBack = () => {
    const target = navigationBackRef.current.pop();
    if (!target) return;
    const currentSnapshot:NavigationSnapshot = {active,libraryView,detail,activePlaylistId};
    navigationForwardRef.current.push(currentSnapshot);
    applyNavigation(target);
  };

  const goForward = () => {
    const target = navigationForwardRef.current.pop();
    if (!target) return;
    const currentSnapshot:NavigationSnapshot = {active,libraryView,detail,activePlaylistId};
    navigationBackRef.current.push(currentSnapshot);
    applyNavigation(target);
  };

  const chooseProfileBanner = async () => {
    const selected = await open({
      directory:false,
      multiple:false,
      title:'Choose a Reson profile banner',
      filters:[{name:'Images',extensions:['png','jpg','jpeg','webp']}]
    });
    if(typeof selected === 'string'){
      setProfileBanner(selected);
      const fresh={x:50,y:50,zoom:1};
      setBannerCrop(fresh);
      setCropEditor({kind:'banner',draft:fresh});
    }
  };

  const chooseAppBackground = async () => {
    const selected = await open({
      directory:false,
      multiple:false,
      title:'Choose a Reson background',
      filters:[{name:'Images',extensions:['png','jpg','jpeg','webp']}]
    });
    if(typeof selected === 'string') setAppBackground(bg=>({...bg,mode:'custom',path:selected}));
  };

  const chooseProfilePicture = async () => {
    const selected = await open({
      directory:false,
      multiple:false,
      title:'Choose a Reson profile picture',
      filters:[{name:'Images',extensions:['png','jpg','jpeg','webp']}]
    });
    if(typeof selected === 'string'){
      setProfilePicture(selected);
      const fresh={x:50,y:50,zoom:1.04};
      setAvatarCrop(fresh);
      setCropEditor({kind:'avatar',draft:fresh});
    }
  };

  const renameProfile = () => {
    const name = window.prompt('What should Reson call you?', profileName);
    if (!name?.trim()) return;
    setProfileName(name.trim().slice(0,40));
  };

  const savePlaybackSession = (force = false) => {
    if (!sessionReadyRef.current || !tracks.length) return;
    const now = Date.now();
    if (!force && now - lastSessionSaveRef.current < 5000) return;
    const session: PlaybackSession = {
      trackId: loadedTrackId.current ?? current?.id ?? null,
      positionSeconds: elapsedSeconds,
      queueIds,
      shuffleOn,
      repeatMode,
      active,
      libraryView,
      activePlaylistId,
      playbackContextIds,
      playbackContextPlaylistId,
      savedAt: now
    };
    localStorage.setItem('reson.playbackSession', JSON.stringify(session));
    lastSessionSaveRef.current = now;
  };

  const restorePlaybackSession = async (library: Track[]) => {
    const clearSession = () => localStorage.removeItem('reson.playbackSession');
    const validViews:View[]=['home','library','playlists','discover','stats','settings','profile'];
    const validLibraryViews:LibraryView[]=['overview','liked','albums','artists','songs'];
    const validRepeat:RepeatMode[]=['off','all','one'];

    let raw:unknown=null;
    try {
      const stored=localStorage.getItem('reson.playbackSession');
      if(!stored){sessionReadyRef.current=true;return false;}
      raw=JSON.parse(stored);
    } catch {
      clearSession();
      sessionReadyRef.current=true;
      setScanMessage('A damaged playback session was discarded. Your library loaded normally.');
      addNotice('Playback session repaired','Reson found unreadable session data and safely reset only the previous playback state.','system');
      return false;
    }

    if(!raw || typeof raw!=='object'){
      clearSession();
      sessionReadyRef.current=true;
      return false;
    }

    const input=raw as Partial<PlaybackSession>;
    const trackId=typeof input.trackId==='string'?input.trackId:null;
    if(!trackId){
      clearSession();
      sessionReadyRef.current=true;
      return false;
    }

    const track=library.find(t=>t.id===trackId&&!!t.path);
    if(!track){
      clearSession();
      sessionReadyRef.current=true;
      setScanMessage('Your previous track could not be found. Reson started with a clean playback state.');
      addNotice('Previous track unavailable','The song from your last session could not be found. Queue and playback state were reset, but your library, likes and playlists were preserved.','playback');
      return false;
    }

    const usableIds=new Set(library.filter(t=>t.path).map(t=>t.id));
    const dedupe=(ids:unknown)=>{
      if(!Array.isArray(ids))return [] as string[];
      const seen=new Set<string>();
      return ids.filter((id):id is string=>typeof id==='string'&&usableIds.has(id)&&!seen.has(id)&&(seen.add(id),true));
    };

    const restoredContext=dedupe(input.playbackContextIds);
    const contextIds=restoredContext.length?restoredContext:library.filter(t=>t.path).map(t=>t.id);
    if(!contextIds.includes(track.id))contextIds.unshift(track.id);

    const restoredQueue=dedupe(input.queueIds).filter(id=>id!==track.id);
    const restoredPlaylistId=typeof input.playbackContextPlaylistId==='string'&&playlists.some(p=>p.id===input.playbackContextPlaylistId)
      ? input.playbackContextPlaylistId
      : null;
    const restoredActivePlaylist=typeof input.activePlaylistId==='string'&&playlists.some(p=>p.id===input.activePlaylistId)
      ? input.activePlaylistId
      : null;

    const index=library.findIndex(t=>t.id===track.id);
    setCurrentIndex(Math.max(0,index));
    setPlaybackContextIds(contextIds);
    setPlaybackContextPlaylistId(restoredPlaylistId);
    setQueueIds(restoredQueue);
    setShuffleOn(typeof input.shuffleOn==='boolean'?input.shuffleOn:false);
    setRepeatMode(validRepeat.includes(input.repeatMode as RepeatMode)?input.repeatMode as RepeatMode:'off');
    setActive(validViews.includes(input.active as View)?input.active as View:'home');
    setLibraryView(validLibraryViews.includes(input.libraryView as LibraryView)?input.libraryView as LibraryView:'overview');
    setActivePlaylistId(restoredActivePlaylist);

    try {
      await invoke('audio_play_file',{path:track.path,volume:0});
      loadedTrackId.current=track.id;

      const requestedPosition=typeof input.positionSeconds==='number'&&Number.isFinite(input.positionSeconds)
        ? input.positionSeconds
        : 0;
      const safePosition=Math.max(0,Math.min(requestedPosition,Math.max(0,track.durationSeconds-.25)));
      if(safePosition>.1)await invoke('audio_seek',{seconds:safePosition});
      await invoke('audio_pause');
      await invoke('audio_set_volume',{volume:volume/100});

      setElapsedSeconds(safePosition);
      setPlaying(false);
      setScanMessage(`Session restored · ${track.title} at ${formatTime(safePosition)}`);

      const removedQueueCount=Array.isArray(input.queueIds)?input.queueIds.length-restoredQueue.length:0;
      const repairedContext=Array.isArray(input.playbackContextIds)&&input.playbackContextIds.length!==contextIds.length;
      const repairs=[
        removedQueueCount>0?`${removedQueueCount} unavailable queued track${removedQueueCount===1?'':'s'} removed`:'',
        repairedContext?'playback context rebuilt':'',
        input.playbackContextPlaylistId&&!restoredPlaylistId?'missing playlist context cleared':''
      ].filter(Boolean).join(' · ');

      addNotice(
        repairs?'Session restored with repairs':'Session restored',
        `${track.title} is ready at ${formatTime(safePosition)}${repairs?` · ${repairs}`:''}.`,
        'playback'
      );

      // Immediately overwrite stale/corrupt values with the sanitized state.
      const repairedSession:PlaybackSession={
        trackId:track.id,
        positionSeconds:safePosition,
        queueIds:restoredQueue,
        shuffleOn:typeof input.shuffleOn==='boolean'?input.shuffleOn:false,
        repeatMode:validRepeat.includes(input.repeatMode as RepeatMode)?input.repeatMode as RepeatMode:'off',
        active:validViews.includes(input.active as View)?input.active as View:'home',
        libraryView:validLibraryViews.includes(input.libraryView as LibraryView)?input.libraryView as LibraryView:'overview',
        activePlaylistId:restoredActivePlaylist,
        playbackContextIds:contextIds,
        playbackContextPlaylistId:restoredPlaylistId,
        savedAt:Date.now()
      };
      localStorage.setItem('reson.playbackSession',JSON.stringify(repairedSession));
    } catch (error) {
      loadedTrackId.current=null;
      setPlaying(false);
      setElapsedSeconds(0);
      setQueueIds([]);
      setPlaybackContextIds(library.filter(t=>t.path).map(t=>t.id));
      setPlaybackContextPlaylistId(null);
      clearSession();
      setScanMessage(`Reson could not restore the previous audio session, so it was reset safely. ${String(error)}`);
      addNotice('Playback recovery reset','The previous audio session failed to load and was safely discarded. Your library and personal data were not changed.','system');
      sessionReadyRef.current=true;
      return false;
    }

    sessionReadyRef.current=true;
    return true;
  };

  const scanFolder = async (target: string, userInitiated: boolean) => {
    setScanBusy(true);
    setScanMessage('Scanning your music and artwork…');
    const scanStarted=performance.now();
    try {
      const result = await invoke<ScanResult>('scan_music_folder', { folder: target });
      const scanMs=Math.max(0,Math.round(performance.now()-scanStarted));
      setLastScanMs(scanMs);
      localStorage.setItem('reson.lastScanMs',String(scanMs));
      const previousIds = new Set(tracks.map(track=>track.id));
      const nextIds = new Set(result.tracks.map(track=>track.id));
      const removedTracks = tracks.filter(track=>!nextIds.has(track.id));
      const addedTracks = result.tracks.filter(track=>!previousIds.has(track.id));
      const unavailablePlaylistRefs = new Set(
        playlists.flatMap(playlist=>playlist.trackIds).filter(id=>!nextIds.has(id))
      );
      setTracks(result.tracks);
      setFolder(result.folder);
      localStorage.setItem('reson.musicFolder', result.folder);
      loadedTrackId.current = null;
      setPlaying(false);
      if (userInitiated) {
        localStorage.removeItem('reson.playbackSession');
        setCurrentIndex(0);
        setQueueIds([]);
        setPlaybackContextIds(result.tracks.filter(t=>t.path).map(t=>t.id));
        setPlaybackContextPlaylistId(null);
        setElapsedSeconds(0);
        sessionReadyRef.current = true;
        setScanMessage(`${result.tracks.length} track${result.tracks.length === 1 ? '' : 's'} found${result.skipped ? ` · ${result.skipped} skipped` : ''}`);
        const changes = [
          addedTracks.length ? `${addedTracks.length} added` : '',
          removedTracks.length ? `${removedTracks.length} missing/removed` : '',
          unavailablePlaylistRefs.size ? `${unavailablePlaylistRefs.size} unavailable playlist reference${unavailablePlaylistRefs.size===1?'':'s'} preserved` : ''
        ].filter(Boolean).join(' · ');
        addNotice(
          'Library scan complete',
          `${result.tracks.length} track${result.tracks.length===1?'':'s'} indexed${result.skipped?` · ${result.skipped} skipped`:''}${changes?` · ${changes}`:''}.`,
          'library'
        );
        setActive('library');
      } else {
        const restored = await restorePlaybackSession(result.tracks);
        if (!restored) {
          setCurrentIndex(0);
          setQueueIds([]);
          setPlaybackContextIds(result.tracks.filter(t=>t.path).map(t=>t.id));
          setPlaybackContextPlaylistId(null);
          setElapsedSeconds(0);
          if (!localStorage.getItem('reson.playbackSession')) setScanMessage(`${result.tracks.length} track${result.tracks.length === 1 ? '' : 's'} found${result.skipped ? ` · ${result.skipped} skipped` : ''}`);
        }
      }
    } catch (error) {
      setScanMessage(`Could not scan that folder: ${String(error)}`);
    } finally {
      setScanBusy(false);
    }
  };

  const startNativeTrack = async (track: Track) => {
    if (!track.path) {
      setScanMessage('Choose a music folder to play your own files.');
      return;
    }
    try {
      setElapsedSeconds(0);
      crossfadeRef.current = false;
      gaplessQueuedRef.current = null;
      await invoke('audio_play_file', { path: track.path, volume: volume / 100 });
      loadedTrackId.current = track.id;
      setPlaying(true);
      recordStartedTrack(track);
    } catch (error) {
      setPlaying(false);
      loadedTrackId.current = null;
      const message=String(error);
      const looksMissing=/not found|no such file|cannot find|os error 2|path.*exist/i.test(message);
      if(looksMissing){
        setScanMessage(`That file is no longer available at its indexed location. Rescan the library after moving, renaming or deleting music.`);
        addNotice('Track file unavailable',`${track.title} could not be found. Your likes and playlist references were kept so they can recover if the file returns.`,'library');
      }else{
        setScanMessage(`Playback failed: ${message}`);
      }
    }
  };

  const recordStartedTrack = (track: Track) => {
    const now = Date.now();
    setHistory((items) => [{ trackId: track.id, playedAt: now }, ...items].slice(0, 5000));
    setPlayCounts((counts) => ({ ...counts, [track.id]: (counts[track.id] ?? 0) + 1 }));
  };

  const beginCrossfadeTo = async (track: Track, remainingIds: string[]) => {
    if (!track.path || crossfadeRef.current) return;
    crossfadeRef.current = true;
    gaplessQueuedRef.current = null;
    try {
      await invoke('audio_crossfade_to', {
        path: track.path,
        volume: volume / 100,
        durationSeconds: Math.max(0.25, audioSettings.crossfade)
      });
      const index = tracks.findIndex((item) => item.id === track.id);
      if (index >= 0) setCurrentIndex(index);
      setQueueIds(remainingIds);
      loadedTrackId.current = track.id;
      setElapsedSeconds(0);
      setPlaying(true);
      recordStartedTrack(track);
      window.setTimeout(() => { crossfadeRef.current = false; }, Math.max(500, audioSettings.crossfade * 1000 + 250));
    } catch (error) {
      crossfadeRef.current = false;
      setScanMessage(`Crossfade failed: ${String(error)}`);
    }
  };

  const armGaplessNext = async (track: Track) => {
    if (!track.path || gaplessQueuedRef.current === track.id) return;
    try {
      await invoke('audio_queue_next', { path: track.path });
      gaplessQueuedRef.current = track.id;
    } catch (error) {
      gaplessQueuedRef.current = null;
      setScanMessage(`Gapless queue failed: ${String(error)}`);
    }
  };

  const contextTracks = (ids:string[] = playbackContextIds) => ids.map(id=>tracks.find(track=>track.id===id)).filter((track):track is Track=>!!track&&!!track.path);

  const makeQueue = (track: Track, context: Track[] = tracks, shuffle = shuffleOn) => {
    const usable = context.filter(item=>item.path);
    if (shuffle) return shuffleArray(usable.filter(item=>item.id!==track.id)).map(item=>item.id);
    const index = usable.findIndex(item=>item.id===track.id);
    if (index < 0) return usable.filter(item=>item.id!==track.id).map(item=>item.id);
    return usable.slice(index+1).map(item=>item.id);
  };

  const setPlaybackContext = (context:Track[], playlistId:string|null=null) => {
    const ids=context.filter(track=>track.path).map(track=>track.id);
    setPlaybackContextIds(ids);
    setPlaybackContextPlaylistId(playlistId);
    return ids;
  };

  const playTrack = (track: Track, context?: Track[], playlistId:string|null=null) => {
    const index = visibleTracks.findIndex(item=>item.id===track.id);
    if (index < 0) return;
    if (!track.path) {
      setCurrentIndex(index);
      setScanMessage('Choose a music folder to play your own files.');
      return;
    }
    const activeContext=(context?.length?context:tracks).filter(item=>item.path);
    setPlaybackContext(activeContext,playlistId);
    setCurrentIndex(index);
    setQueueIds(makeQueue(track,activeContext));
    void startNativeTrack(track);
  };

  const playPlaylist = (playlist:Playlist, shuffled=false) => {
    const playlistTracks=playlist.trackIds.map(id=>tracks.find(track=>track.id===id)).filter((track):track is Track=>!!track&&!!track.path);
    if(!playlistTracks.length){setScanMessage('This playlist does not have any playable songs yet.');return;}
    const order=shuffled?shuffleArray(playlistTracks):playlistTracks;
    const first=order[0];
    setPlaybackContext(playlistTracks,playlist.id);
    setShuffleOn(shuffled);
    const index=tracks.findIndex(track=>track.id===first.id);
    if(index>=0)setCurrentIndex(index);
    setQueueIds(order.slice(1).map(track=>track.id));
    void startNativeTrack(first);
  };

  const togglePlayback = async () => {
    if (!current?.path) {
      setScanMessage('Import a music folder first, then Reson can play your tracks.');
      return;
    }
    try {
      if (loadedTrackId.current !== current.id) {
        if(!playbackContextIds.length) setPlaybackContext(tracks,null);
        await startNativeTrack(current);
      } else if (playing) {
        await invoke('audio_pause');
        setPlaying(false);
        window.setTimeout(() => savePlaybackSession(true), 0);
      } else {
        await invoke('audio_resume');
        setPlaying(true);
      }
    } catch (error) {
      setScanMessage(`Playback failed: ${String(error)}`);
    }
  };

  const playQueuedTrack = async (track: Track, remainingIds: string[]) => {
    const index = tracks.findIndex(item=>item.id===track.id);
    if (index >= 0) setCurrentIndex(index);
    setQueueIds(remainingIds);
    await startNativeTrack(track);
  };

  const advanceTrack = async (direction: 1 | -1) => {
    if (!tracks.length) return;
    const context=contextTracks();
    if(!context.length) return;

    if(direction===1){
      if(queuedTracks.length){
        await playQueuedTrack(queuedTracks[0],queueIds.slice(1));
        return;
      }
      if(repeatMode==='all'){
        const ordered=shuffleOn?shuffleArray(context.filter(track=>track.id!==current.id)):context;
        const next=shuffleOn?ordered[0]:context[0];
        if(next){
          const remaining=shuffleOn?ordered.slice(1).map(t=>t.id):makeQueue(next,context,false);
          await playQueuedTrack(next,remaining);
        }
      }
      return;
    }

    const currentContextIndex=context.findIndex(track=>track.id===current.id);
    if(currentContextIndex<0)return;
    let targetIndex=currentContextIndex-1;
    if(targetIndex<0){
      if(repeatMode!=='all')return;
      targetIndex=context.length-1;
    }
    const previous=context[targetIndex];
    if(!previous)return;
    const remaining=shuffleOn
      ? shuffleArray(context.filter(track=>track.id!==previous.id)).map(track=>track.id)
      : makeQueue(previous,context,false);
    await playQueuedTrack(previous,remaining);
  };

  const handleTrackEnded = async () => {
    if (!tracks.length || !loadedTrackId.current) return;
    if (repeatMode === 'one') {
      await startNativeTrack(current);
      return;
    }
    if (queuedTracks.length) {
      await playQueuedTrack(queuedTracks[0], queueIds.slice(1));
      return;
    }
    if (repeatMode === 'all') {
      const context=contextTracks();
      if(context.length){
        const next=shuffleOn?shuffleArray(context)[0]:context[0];
        if(next){
          const remaining=shuffleOn?shuffleArray(context.filter(t=>t.id!==next.id)).map(t=>t.id):makeQueue(next,context,false);
          await playQueuedTrack(next,remaining);
          return;
        }
      }
    }
    loadedTrackId.current = null;
    setPlaying(false);
    setElapsedSeconds(duration);
    await invoke('audio_stop').catch(() => undefined);
  };

  const nextTrack = () => void advanceTrack(1);
  const previousTrack = async () => {
    if (!tracks.length) return;
    if (elapsedSeconds > 4 && loadedTrackId.current === current.id) {
      await invoke('audio_seek', { seconds: 0 });
      setElapsedSeconds(0);
      return;
    }
    await advanceTrack(-1);
  };

  const seek = async (value: number) => {
    if (!current?.path || !duration) return;
    const seconds = (value / 100) * duration;
    setElapsedSeconds(seconds);
    try {
      await invoke('audio_seek', { seconds });
      window.setTimeout(() => savePlaybackSession(true), 0);
    } catch (error) {
      setScanMessage(`Seek failed: ${String(error)}`);
    }
  };

  const jumpToQueuedTrack = (track: Track) => {
    const at = queueIds.indexOf(track.id);
    const remaining = at >= 0 ? queueIds.slice(at + 1) : makeQueue(track,contextTracks(),shuffleOn);
    void playQueuedTrack(track, remaining);
  };

  const toggleShuffle = () => {
    const next = !shuffleOn;
    setShuffleOn(next);
    const context=contextTracks();
    if (!context.length) return;
    const currentPos=context.findIndex(track=>track.id===current.id);
    const remaining = next
      ? shuffleArray(context.filter(track=>track.id!==current.id))
      : currentPos>=0 ? context.slice(currentPos+1) : context;
    setQueueIds(remaining.map(track=>track.id));
  };

  const cycleRepeat = () => setRepeatMode((mode) => mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off');

  const removeFromQueue = (trackId: string) => setQueueIds((ids) => ids.filter((id) => id !== trackId));
  const moveQueueItem = (index: number, direction: -1 | 1) => setQueueIds((ids) => {
    const target = index + direction;
    if (target < 0 || target >= ids.length) return ids;
    const next = [...ids];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });

  const createPlaylist = () => {
    const name = window.prompt('Name this playlist');
    if (!name?.trim()) return;
    const playlist: Playlist = { id: `playlist-${Date.now()}`, name: name.trim(), trackIds: [], createdAt: Date.now() };
    setPlaylists((items) => [...items, playlist]);
    setActivePlaylistId(playlist.id);
    setActive('playlists');
  };

  const renamePlaylist = (playlistId: string) => {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return;
    const name = window.prompt('Rename playlist', playlist.name);
    if (!name?.trim()) return;
    setPlaylists(items => items.map(p => p.id === playlistId ? {...p, name:name.trim()} : p));
  };

  const movePlaylistTrack = (playlistId: string, index: number, direction: -1 | 1) => {
    setPlaylists(items => items.map(p => {
      if (p.id !== playlistId) return p;
      const target = index + direction;
      if (target < 0 || target >= p.trackIds.length) return p;
      const ids = [...p.trackIds];
      [ids[index], ids[target]] = [ids[target], ids[index]];
      return {...p, trackIds: ids};
    }));
  };

  const addTracksToPlaylist = (playlistId:string, trackIds:string[]) => {
    setPlaylists(items => items.map(playlist => {
      if(playlist.id!==playlistId) return playlist;
      const merged=[...playlist.trackIds];
      for(const id of trackIds) if(!merged.includes(id)) merged.push(id);
      return {...playlist,trackIds:merged};
    }));
  };

  const choosePlaylistCover = async (playlistId:string) => {
    const selected = await open({directory:false,multiple:false,title:'Choose playlist cover',filters:[{name:'Images',extensions:['png','jpg','jpeg','webp']}]});
    if(typeof selected!=='string') return;
    setPlaylists(items=>items.map(p=>p.id===playlistId?{...p,coverPath:selected}:p));
  };

  const clearPlaylistCover = (playlistId:string) => {
    setPlaylists(items=>items.map(p=>p.id===playlistId?{...p,coverPath:undefined}:p));
  };

  const showInExplorer = async (track:Track) => {
    if(!track.path) return;
    try { await invoke('reveal_in_explorer',{path:track.path}); }
    catch(error){ setScanMessage(`Could not open File Explorer: ${String(error)}`); }
  };

const addTrackToPlaylist = (playlistId: string, trackId: string) => {
    setPlaylists((items) => items.map((playlist) => playlist.id === playlistId && !playlist.trackIds.includes(trackId)
      ? { ...playlist, trackIds: [...playlist.trackIds, trackId] }
      : playlist));
  };

  const removeTrackFromPlaylist = (playlistId: string, trackId: string) => {
    setPlaylists((items) => items.map((playlist) => playlist.id === playlistId
      ? { ...playlist, trackIds: playlist.trackIds.filter((id) => id !== trackId) }
      : playlist));
  };

  const deletePlaylist = (playlistId: string) => {
    setPlaylists((items) => items.filter((playlist) => playlist.id !== playlistId));
    setActivePlaylistId(null);
  };

  const bulkLike = () => {
    setLikedIds(ids=>{
      const next=new Set(ids);
      const allLiked=selectedTrackIds.every(id=>next.has(id));
      for(const id of selectedTrackIds){if(allLiked)next.delete(id);else next.add(id);}
      return [...next];
    });
  };
  const bulkQueue = () => {
    setQueueIds(ids=>[...ids,...selectedTrackIds.filter(id=>!ids.includes(id))]);
  };

  const recentTracks = useMemo(() => {
    const seen = new Set<string>();
    return history.map((entry) => tracks.find((track) => track.id === entry.trackId)).filter((track): track is Track => {
      if (!track || seen.has(track.id)) return false;
      seen.add(track.id);
      return true;
    });
  }, [history, tracks]);


  const socialApi=async<T,>(path:string,options:RequestInit={}):Promise<T>=>{
    const base=serverUrl.trim().replace(/\/+$/,'');
    if(!base)throw new Error('Set a Reson Server URL first.');
    const headers=new Headers(options.headers||{});
    headers.set('Content-Type','application/json');
    if(socialToken)headers.set('Authorization',`Bearer ${socialToken}`);
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),6000);
    try{
      const response=await fetch(`${base}${path}`,{...options,headers,signal:controller.signal});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data?.error||`Server returned ${response.status}`);
      return data as T;
    }finally{clearTimeout(timeout);}
  };

  const refreshSocial=async()=>{
    if(!socialToken)return;
    setSocialStatus('connecting');
    try{
      const [me,friends,requests,board]=await Promise.all([
        socialApi<{user:SocialUser}>('/api/me'),
        socialApi<{friends:SocialUser[]}>('/api/friends'),
        socialApi<{requests:FriendRequest[]}>('/api/friends/requests'),
        socialApi<{leaderboard:LeaderboardEntry[]}>(`/api/leaderboards?metric=${leaderboardMetric}`)
      ]);
      setSocialUser(me.user);setSocialFriends(friends.friends);setFriendRequests(requests.requests);setLeaderboard(board.leaderboard);
      setSocialStatus('online');setSocialMessage('');
    }catch(error){
      setSocialStatus('offline');
      setSocialMessage(`Server unavailable: ${String(error).replace(/^Error:\s*/,'')}`);
    }
  };

  const socialLogin=async(username:string,password:string,register:boolean)=>{
    setSocialStatus('connecting');setSocialMessage('');
    try{
      const result=await socialApi<{token:string;user:SocialUser}>(register?'/api/auth/register':'/api/auth/login',{
        method:'POST',
        body:JSON.stringify(register?{username,password,displayName:profileName}:{username,password})
      });
      setSocialToken(result.token);setSocialUser(result.user);setSocialStatus('online');setSocialMessage(register?'Account created.':'Signed in.');
    }catch(error){setSocialStatus('offline');setSocialMessage(String(error).replace(/^Error:\s*/,''));}
  };

  const socialLogout=()=>{
    setSocialToken('');setSocialUser(null);setSocialFriends([]);setFriendRequests([]);setLeaderboard([]);setSocialStatus('idle');setSocialMessage('Signed out.');
  };

  const sendFriendRequest=async(username:string)=>{
    try{await socialApi('/api/friends/request',{method:'POST',body:JSON.stringify({username})});setSocialMessage(`Friend request sent to ${username}.`);}
    catch(error){setSocialMessage(String(error).replace(/^Error:\s*/,''));}
  };
  const respondFriendRequest=async(id:number,accept:boolean)=>{
    try{await socialApi(`/api/friends/requests/${id}/${accept?'accept':'decline'}`,{method:'POST'});await refreshSocial();}
    catch(error){setSocialMessage(String(error).replace(/^Error:\s*/,''));}
  };

  const weeklySocialSeconds=useMemo(()=>currentWeekListening(dailyListenSeconds).reduce((sum,d)=>sum+d.seconds,0),[dailyListenSeconds]);
  const socialTopArtist=useMemo(()=>{
    const counts=new Map<string,number>();
    for(const track of tracks)counts.set(track.artist,(counts.get(track.artist)??0)+(playCounts[track.id]??0));
    return [...counts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]??'';
  },[tracks,playCounts]);

  useEffect(()=>{
    if(!socialToken)return;
    void refreshSocial();
    const timer=window.setInterval(()=>void refreshSocial(),60000);
    return ()=>window.clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[socialToken,serverUrl,leaderboardMetric]);

  useEffect(()=>{
    if(!socialToken||socialStatus==='offline')return;
    const timer=window.setTimeout(()=>{
      void socialApi('/api/me/profile',{method:'PATCH',body:JSON.stringify({displayName:profileName,bio:profileBio})}).catch(()=>{});
      void socialApi('/api/me/stats',{method:'PUT',body:JSON.stringify({
        totalListenSeconds,weeklyListenSeconds:weeklySocialSeconds,songsInLibrary:tracks.length,
        likedSongs:likedIds.length,playlists:playlists.length,topArtist:socialTopArtist
      })}).catch(()=>{});
    },1200);
    return ()=>window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[socialToken,profileName,profileBio,totalListenSeconds,weeklySocialSeconds,tracks.length,likedIds.length,playlists.length,socialTopArtist]);

  useEffect(()=>{
    if(!socialToken)return;
    const timer=window.setTimeout(()=>{
      void socialApi('/api/me/presence',{method:'PUT',body:JSON.stringify({
        status:'online',trackTitle:current?.path?current.title:'',trackArtist:current?.path?current.artist:'',
        trackAlbum:current?.path?current.album:'',isPlaying:!!(current?.path&&playing)
      })}).catch(()=>{});
    },350);
    return ()=>window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[socialToken,current?.id,playing]);


  const inspectCloudBackup=async()=>{
    if(!socialToken)return;
    try{
      const result=await socialApi<{backup:null|{updatedAt:number}}>('/api/me/backup');
      setCloudBackupUpdatedAt(result.backup?.updatedAt??null);
    }catch{}
  };

  const backupThisDevice=async()=>{
    if(!socialToken||cloudSyncBusy)return;
    setCloudSyncBusy(true);setSocialMessage('Preparing this device for cloud backup…');
    try{
      const trackRefs=new Map(tracks.map(t=>[t.id,normalizedTrackRef(t)] as const));
      const picture=await imageToPortableData(profilePicture);
      const banner=await imageToPortableData(profileBanner);
      const bgPath=appBackground.mode==='custom'?await imageToPortableData(appBackground.path):'';
      const playlistBackups=[];
      for(const playlist of playlists){
        playlistBackups.push({
          id:playlist.id,name:playlist.name,createdAt:playlist.createdAt,
          coverPath:playlist.coverPath?await imageToPortableData(playlist.coverPath):'',
          trackRefs:playlist.trackIds.map(id=>trackRefs.get(id)).filter((v):v is string=>!!v)
        });
      }
      const backup:ResonAccountBackup={
        profile:{
          name:profileName,bio:profileBio,picture,banner,avatarCrop,bannerCrop,
          showcase:profileShowcase.map(item=>item.kind==='track'
            ?{...item,value:trackRefs.get(item.value)??'',valueType:'trackRef' as const}
            :{...item})
        },
        library:{
          liked:likedIds.map(id=>trackRefs.get(id)).filter((v):v is string=>!!v),
          playCounts:Object.entries(playCounts).map(([id,count])=>[trackRefs.get(id),count] as const).filter((x):x is [string,number]=>!!x[0]),
          history:history.map(h=>({ref:trackRefs.get(h.trackId)??'',playedAt:h.playedAt})).filter(h=>!!h.ref),
          playlists:playlistBackups
        },
        stats:{totalListenSeconds,dailyListenSeconds,weeklyRecaps},
        preferences:{
          volume,audioSettings,librarySort,nowPlayingMode,
          appBackground:{...appBackground,path:bgPath}
        },
        createdAt:Date.now()
      };
      const result=await socialApi<{ok:boolean;updatedAt:number;bytes:number}>('/api/me/backup',{method:'PUT',body:JSON.stringify({schemaVersion:1,payload:backup})});
      setCloudBackupUpdatedAt(result.updatedAt);
      setSocialMessage(`Cloud backup saved · ${(result.bytes/1024).toFixed(1)} KB`);
    }catch(error){setSocialMessage(`Backup failed: ${String(error).replace(/^Error:\s*/,'')}`);}
    finally{setCloudSyncBusy(false);}
  };

  const restoreAccountBackup=async()=>{
    if(!socialToken||cloudSyncBusy)return;
    setCloudSyncBusy(true);setSocialMessage('Restoring account backup…');
    try{
      const result=await socialApi<{backup:null|{updatedAt:number;payload:ResonAccountBackup}}>('/api/me/backup');
      if(!result.backup)throw new Error('This account does not have a cloud backup yet.');
      const backup=result.backup.payload;
      const localByRef=new Map(tracks.map(t=>[normalizedTrackRef(t),t] as const));

      setProfileName(backup.profile?.name||profileName);
      setProfileBio(backup.profile?.bio??'');
      setProfilePicture(backup.profile?.picture??'');
      setProfileBanner(backup.profile?.banner??'');
      if(backup.profile?.avatarCrop)setAvatarCrop(backup.profile.avatarCrop);
      if(backup.profile?.bannerCrop)setBannerCrop(backup.profile.bannerCrop);

      const restoredPlaylists=(backup.library?.playlists??[]).map(p=>({
        id:p.id,name:p.name,createdAt:p.createdAt,coverPath:p.coverPath||undefined,
        trackIds:p.trackRefs.map(ref=>localByRef.get(ref)?.id).filter((id):id is string=>!!id)
      }));
      setPlaylists(restoredPlaylists);

      setProfileShowcase((backup.profile?.showcase??[]).map(item=>{
        if(item.kind==='track'&&item.valueType==='trackRef')return {...item,value:localByRef.get(item.value)?.id??''};
        return item;
      }).filter(item=>item.kind!=='track'||!!item.value));

      setLikedIds((backup.library?.liked??[]).map(ref=>localByRef.get(ref)?.id).filter((id):id is string=>!!id));
      const restoredCounts:PlayCounts={};
      for(const [ref,count] of backup.library?.playCounts??[]){const id=localByRef.get(ref)?.id;if(id)restoredCounts[id]=count;}
      setPlayCounts(restoredCounts);
      setHistory((backup.library?.history??[]).map(h=>({trackId:localByRef.get(h.ref)?.id??'',playedAt:h.playedAt})).filter(h=>!!h.trackId));
      setTotalListenSeconds(Math.max(0,backup.stats?.totalListenSeconds??0));
      setDailyListenSeconds(backup.stats?.dailyListenSeconds??{});
      setWeeklyRecaps(backup.stats?.weeklyRecaps??[]);

      if(backup.preferences){
        setVolume(backup.preferences.volume??volume);
        setAudioSettings(backup.preferences.audioSettings??audioSettings);
        setLibrarySort(backup.preferences.librarySort??librarySort);
        setNowPlayingMode(backup.preferences.nowPlayingMode??nowPlayingMode);
        setAppBackground(backup.preferences.appBackground??appBackground);
      }

      setCloudBackupUpdatedAt(result.backup.updatedAt);
      const missing=(backup.library?.playlists??[]).reduce((n,p)=>n+p.trackRefs.filter(ref=>!localByRef.has(ref)).length,0);
      setSocialMessage(`Account restored.${missing?` ${missing} playlist track reference${missing===1?'':'s'} could not be matched on this device yet.`:''}`);
    }catch(error){setSocialMessage(`Restore failed: ${String(error).replace(/^Error:\s*/,'')}`);}
    finally{setCloudSyncBusy(false);}
  };

  useEffect(()=>{if(socialToken)void inspectCloudBackup();else setCloudBackupUpdatedAt(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[socialToken,serverUrl]);

  const content = useMemo(() => {
    if (active === 'home') return <HomeView tracks={tracks} demos={demoTracks} recentTracks={recentTracks} playCounts={playCounts} profileName={profileName} onPlay={playTrack} onContext={(e,t)=>{e.preventDefault();if(t.path)setContextMenu({x:e.clientX,y:e.clientY,trackId:t.id})}} onImport={chooseFolder} onNavigate={(target)=>{setDetail(null);if(target==='stats'){setActive('stats');return;}setLibraryView(target);setActive('library')}} />;
    if (active === 'library') {
      if (!detail && libraryView === 'overview') return <LibraryOverview tracks={tracks} likedIds={likedIds} playCounts={playCounts} totalListenSeconds={totalListenSeconds} onPlay={playTrack} onContext={(e,t)=>{e.preventDefault();setContextMenu({x:e.clientX,y:e.clientY,trackId:t.id})}} onOpen={(view)=>setLibraryView(view)} onOpenDetail={(type,name)=>setDetail({type,name})} onImport={()=>setAddMusicOpen(true)} folder={folder} />;
      if (detail?.type === 'album') return <AlbumDetail name={detail.name} tracks={tracks} likedIds={likedIds} playCounts={playCounts} onBack={()=>setDetail(null)} onPlay={playTrack} onArtist={(name)=>setDetail({type:'artist',name})} onContext={(e,t)=>{e.preventDefault();setContextMenu({x:e.clientX,y:e.clientY,trackId:t.id})}} />;
      if (detail?.type === 'artist') return <ArtistDetail name={detail.name} tracks={tracks} playCounts={playCounts} onBack={()=>setDetail(null)} onPlay={playTrack} onAlbum={(name)=>setDetail({type:'album',name})} onContext={(e,t)=>{e.preventDefault();setContextMenu({x:e.clientX,y:e.clientY,trackId:t.id})}} />;
      return <LibraryPage selected={libraryView} tracks={query ? filteredTracks : tracks} onPlay={playTrack} onImport={()=>setAddMusicOpen(true)} onMusicHelper={()=>void openSpotiSaver()} folder={folder} scanBusy={scanBusy} onRescan={() => folder && void scanFolder(folder, false)} likedIds={likedIds} sort={librarySort} onSort={setLibrarySort} playCounts={playCounts} selectedTrackIds={selectedTrackIds} onSelection={setSelectedTrackIds} playlists={playlists} onBulkLike={bulkLike} onBulkQueue={bulkQueue} onBulkPlaylist={addTracksToPlaylist} onOpenDetail={(type,name)=>setDetail({type,name})} onContext={(e,t)=>{e.preventDefault();setContextMenu({x:e.clientX,y:e.clientY,trackId:t.id})}} />;
    }
    if (active === 'stats') return <StatsPage tracks={tracks} playCounts={playCounts} history={history} totalListenSeconds={totalListenSeconds} dailyListenSeconds={dailyListenSeconds} weeklyRecaps={weeklyRecaps} onPlay={playTrack} onContext={(e,t)=>{e.preventDefault();setContextMenu({x:e.clientX,y:e.clientY,trackId:t.id})}} />;
    if (active === 'friends') return <FriendsPage serverUrl={serverUrl} setServerUrl={setServerUrl} token={socialToken} user={socialUser} friends={socialFriends} requests={friendRequests} leaderboard={leaderboard} metric={leaderboardMetric} status={socialStatus} message={socialMessage} onLogin={socialLogin} onLogout={socialLogout} onRefresh={()=>void refreshSocial()} onRequest={sendFriendRequest} onRespond={respondFriendRequest} onMetric={setLeaderboardMetric} cloudBackupUpdatedAt={cloudBackupUpdatedAt} cloudSyncBusy={cloudSyncBusy} onBackup={()=>void backupThisDevice()} onRestore={()=>void restoreAccountBackup()} />;
    if (active === 'settings') return <SettingsPage volume={volume} setVolume={setVolume} settings={audioSettings} setSettings={setAudioSettings} folder={folder} onChangeFolder={()=>setAddMusicOpen(true)} background={appBackground} setBackground={setAppBackground} onChooseBackground={()=>void chooseAppBackground()} diagnostics={{trackCount:tracks.length,queueSize:queueIds.length,currentWaveformSamples:current?.waveform?.length??0,lastScanMs}} />;
    if (active === 'profile') return <ProfilePage profileName={profileName} profilePicture={profilePicture} profileBanner={profileBanner} avatarCrop={avatarCrop} bannerCrop={bannerCrop} profileBio={profileBio} showcase={profileShowcase} tracks={tracks} playlists={playlists} playCounts={playCounts} totalListenSeconds={totalListenSeconds} likedCount={likedIds.length} current={current?.path?current:null} playing={playing} elapsedSeconds={elapsedSeconds} duration={duration} recentTracks={recentTracks} dailyListenSeconds={dailyListenSeconds} onName={setProfileName} onBio={setProfileBio} onShowcase={setProfileShowcase} onPicture={()=>void chooseProfilePicture()} onEditPicture={()=>setCropEditor({kind:'avatar',draft:{...avatarCrop}})} onRemovePicture={()=>setProfilePicture('')} onBanner={()=>void chooseProfileBanner()} onEditBanner={()=>setCropEditor({kind:'banner',draft:{...bannerCrop}})} onRemoveBanner={()=>setProfileBanner('')} onPlay={playTrack} onPlaylist={(id)=>{setActivePlaylistId(id);setActive('playlists')}} />;
    if (active === 'discover') return <DiscoverPage tracks={tracks} playCounts={playCounts} onMusicHelper={()=>void openSpotiSaver()} />;
    return <PlaylistsPage playlists={playlists} activePlaylistId={activePlaylistId} tracks={tracks} onSelect={setActivePlaylistId} onBack={()=>setActivePlaylistId(null)} onCreate={createPlaylist} onDelete={deletePlaylist} onRename={renamePlaylist} onCover={choosePlaylistCover} onClearCover={clearPlaylistCover} onMoveTrack={movePlaylistTrack} onAddTrack={addTrackToPlaylist} onRemoveTrack={removeTrackFromPlaylist} onPlay={playTrack} onPlayPlaylist={playPlaylist} playingPlaylistId={playbackContextPlaylistId} onContext={(e,t)=>{e.preventDefault();setContextMenu({x:e.clientX,y:e.clientY,trackId:t.id})}} />;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, libraryView, tracks, filteredTracks, query, folder, scanBusy, likedIds, playlists, activePlaylistId, history, playCounts, recentTracks, shuffleOn, detail, contextMenu, audioSettings, volume, profileName, profilePicture, profileBanner, profileBio, profileFavorites, profileShowcase, appBackground, totalListenSeconds, avatarCrop, bannerCrop, playing, elapsedSeconds, duration, dailyListenSeconds, socialToken, socialUser, socialFriends, friendRequests, leaderboard, leaderboardMetric, socialStatus, socialMessage, serverUrl, cloudBackupUpdatedAt, cloudSyncBusy]);

  return (
    <main className={`app-shell tone-${current?.tone ?? 'violet'} ${appBackground.mode==='custom'&&appBackground.path?'has-custom-background':''} ${appBackground.textContrast==='strong'?'text-contrast-strong':''}`}>
      {appBackground.mode==='custom'&&appBackground.path&&<div className="custom-app-background" aria-hidden="true" style={{backgroundImage:`url("${resonImageSrc(appBackground.path)}")`,'--custom-bg-blur':`${appBackground.blur}px`,'--custom-bg-dim':`${appBackground.dim/100}`} as CSSProperties}/>}
      <div className="ambient-layer" aria-hidden="true"><i /><i /><i /></div>

      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><span className="brand-bars"><i/><i/><i/></span><b>R</b></div><span>Reson</span></div>
        <nav className="main-nav">{navItems.map((item) => <button key={item.key} className={active === item.key ? 'active' : ''} onClick={() => {if(item.key==='library'){setDetail(null);setLibraryView('overview');}setActive(item.key)}}><Icon name={item.icon}/><span>{item.label}</span></button>)}</nav>
        <div className="sidebar-divider" />
        <SidebarHeading label="YOUR LIBRARY" />
        <nav className="sub-nav">{libraryItems.map((item) => <button key={item.key} className={active === 'library' && libraryView === item.key ? 'active' : ''} onClick={() => {setLibraryView(item.key);setActive('library');}}><Icon name={item.icon}/><span>{item.label}</span></button>)}</nav>
        <SidebarHeading label="PLAYLISTS" onAdd={createPlaylist} />
        <nav className="playlist-nav">{playlists.map((playlist)=><button key={playlist.id} className={active==='playlists'&&activePlaylistId===playlist.id?'active':''} onClick={()=>{setActivePlaylistId(playlist.id);setActive('playlists')}}><Icon name="playlist"/><span>{playlist.name}</span></button>)}</nav>
        <div className="sidebar-library-actions">
          <button className="music-helper-button" onClick={()=>void openSpotiSaver()} title="Open Spotisaver in your browser"><Icon name="external"/><span><strong>Music Helper</strong><small>Open Spotisaver</small></span></button>
          <div className="library-source-card">
            <span className="source-icon"><Icon name="folder"/></span>
            <div><strong>{folder ? folder.split(/[\\/]/).pop() : 'No folder yet'}</strong><small>{tracks.length ? `${tracks.length} local tracks` : 'Choose your music folder'}</small></div>
            <button onClick={()=>setAddMusicOpen(true)}>{folder ? 'Manage' : 'Add'}</button>
          </div>
        </div>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <div className="history"><button aria-label="Back" title="Back" disabled={navigationBackRef.current.length===0} onClick={goBack}><Icon name="back"/></button><button aria-label="Forward" title="Forward" disabled={navigationForwardRef.current.length===0} onClick={goForward}><Icon name="forward"/></button></div>
          <label className="search"><Icon name="search"/><input value={query} onChange={(e) => {setQuery(e.target.value); if (e.target.value) {setDetail(null);setActive('library');setLibraryView('songs');}}} placeholder="Search your songs, artists, albums..." /></label>
          <div className="account-actions">
            <div className="topbar-popover-wrap"><button className={`notification ${noticesOpen?'active':''}`} aria-label="Activity" title="Reson activity" onClick={()=>{setNoticesOpen(v=>!v);setProfileOpen(false);if(!noticesOpen)setNotices(items=>items.map(n=>({...n,read:true})))}}><Icon name="bell"/>{unreadNotices>0&&<i/>}</button>
              {noticesOpen&&<div className="reson-popover notice-popover" onMouseDown={(e)=>e.stopPropagation()} onClick={(e)=>e.stopPropagation()}><div className="popover-head"><div><span>RESON ACTIVITY</span><strong>Notices</strong></div>{notices.length>0&&<button onClick={(e)=>{e.stopPropagation();setNotices([])}}>Clear</button>}</div>{notices.length?<div className="notice-list">{notices.slice(0,12).map(n=><div className={`notice-item kind-${n.kind}`} key={n.id}><span className="notice-dot"/><div><strong>{n.title}</strong><p>{n.message}</p><small>{relativeTime(n.createdAt)}</small></div></div>)}</div>:<div className="popover-empty"><Icon name="bell"/><strong>All quiet</strong><span>Library and playback notices will appear here.</span></div>}</div>}
            </div>
            <div className="topbar-popover-wrap"><button className={`profile ${profileOpen?'active':''}`} onClick={()=>{setProfileOpen(v=>!v);setNoticesOpen(false)}}><span className="profile-avatar-small">{profilePicture?<img src={resonImageSrc(profilePicture)} alt="" style={cropImageStyle(avatarCrop)}/>:profileInitials}</span><Icon name="chevronDown"/></button>
              {profileOpen&&<div className="reson-popover profile-popover" onMouseDown={(e)=>e.stopPropagation()} onClick={(e)=>e.stopPropagation()}><div className="profile-card"><span className="profile-avatar-large">{profilePicture?<img src={resonImageSrc(profilePicture)} alt="" style={cropImageStyle(avatarCrop)}/>:profileInitials}</span><div><strong>{profileName}</strong><small>Local Reson profile</small></div></div><div className="profile-mini-stats"><span><b>{formatListenTime(totalListenSeconds)}</b> listened</span><span><b>{likedIds.length}</b> liked</span></div><button className="profile-primary-action" onClick={(e)=>{e.stopPropagation();setProfileOpen(false);setNoticesOpen(false);setActive('profile')}}><Icon name="artist"/>View Profile</button><button onClick={(e)=>{e.stopPropagation();setProfileOpen(false);setNoticesOpen(false);setActive('profile')}}><Icon name="album"/>Customize profile</button><button onClick={()=>{setActive('stats');setProfileOpen(false)}}><Icon name="stats"/>Listening stats</button><button onClick={()=>{setActive('settings');setProfileOpen(false)}}><Icon name="settings"/>Settings</button><div className="profile-divider"/><div className="profile-about"><strong>Reson</strong><span>v0.25.2 · Local music player</span></div></div>}
            </div>
          </div>
        </header>
        {scanMessage && <div className="scan-toast"><span className={scanBusy ? 'scanning-dot' : ''}/>{scanMessage}<button onClick={() => setScanMessage('')}>×</button></div>}
        <div className="page-scroll"><div className="page-transition" key={`${active}-${libraryView}-${detail?.type??'none'}-${detail?.name??''}`}>{content}</div></div>
        {(profileOpen||noticesOpen)&&<div className="topbar-dismiss" onMouseDown={()=>{setProfileOpen(false);setNoticesOpen(false)}}/>}
      </section>

      {active === 'home' && <RecentActivity tracks={recentTracks} history={history} onPlay={playTrack} onContext={(e,t)=>{e.preventDefault();setContextMenu({x:e.clientX,y:e.clientY,trackId:t.id})}} onOpenHistory={()=>setActive('stats')} />}

      {cropEditor&&(()=>{
        const isAvatar=cropEditor.kind==='avatar';
        const imagePath=isAvatar?profilePicture:profileBanner;
        const draft=cropEditor.draft;
        const update=(patch:Partial<ImageCrop>)=>setCropEditor(editor=>editor?{...editor,draft:{...editor.draft,...patch}}:editor);
        const save=()=>{if(isAvatar)setAvatarCrop(draft);else setBannerCrop(draft);setCropEditor(null)};
        const reset=()=>update({x:50,y:50,zoom:isAvatar?1.04:1});
        return <div className="cropper-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setCropEditor(null)}}>
          <div className="cropper-modal">
            <div className="cropper-head"><div><span className="eyebrow">IMAGE POSITION</span><h2>{isAvatar?'Crop profile picture':'Crop profile banner'}</h2><p>Move the focus point and zoom until the image sits exactly where you want it.</p></div><button onClick={()=>setCropEditor(null)}>×</button></div>
            <div className={`cropper-preview ${isAvatar?'avatar-preview':'banner-preview'}`}>
              {imagePath&&<img src={convertFileSrc(imagePath)} alt="" style={cropImageStyle(draft)}/>}
              {isAvatar&&<span className="cropper-avatar-ring"/>}
            </div>
            <div className="cropper-controls">
              <label><span>Horizontal <b>{Math.round(draft.x)}%</b></span><input className="cropper-range" type="range" min="0" max="100" value={draft.x} onChange={e=>update({x:Number(e.target.value)})} style={{'--crop-progress':`${draft.x}%`} as CSSProperties}/></label>
              <label><span>Vertical <b>{Math.round(draft.y)}%</b></span><input className="cropper-range" type="range" min="0" max="100" value={draft.y} onChange={e=>update({y:Number(e.target.value)})} style={{'--crop-progress':`${draft.y}%`} as CSSProperties}/></label>
              <label><span>Zoom <b>{draft.zoom.toFixed(2)}×</b></span><input className="cropper-range" type="range" min={isAvatar?1.02:1} max="2.5" step=".01" value={draft.zoom} onChange={e=>update({zoom:Number(e.target.value)})} style={{'--crop-progress':`${((draft.zoom-(isAvatar?1.02:1))/(2.5-(isAvatar?1.02:1)))*100}%`} as CSSProperties}/></label>
            </div>
            <div className="cropper-actions"><button onClick={reset}>Reset</button><span/><button onClick={()=>setCropEditor(null)}>Cancel</button><button className="cropper-save" onClick={save}>Save crop</button></div>
          </div>
        </div>;
      })()}

      {queueOpen && <div className="queue-popover">
        <div className="queue-popover-head"><div><span>PLAYBACK</span><strong>Up Next</strong><small>{queuedTracks.length} track{queuedTracks.length===1?'':'s'} · {playbackPlaylist?playbackPlaylist.name:'Library'} · {shuffleOn?'Shuffle on':'In order'}</small></div><div className="queue-head-actions">{queuedTracks.length>0&&<button className="queue-clear" onClick={()=>setQueueIds([])}>Clear</button>}<button className="queue-close" onClick={() => setQueueOpen(false)}>×</button></div></div>
        <div className="queue-now"><AlbumArt track={current} size="activity"/><div><small>NOW PLAYING</small><strong>{current.title}</strong><span>{current.artist}</span></div></div>
        <div className="queue-list">{queuedTracks.length ? queuedTracks.slice(0,40).map((track,index)=><div className="queue-item" key={`${track.id}-${index}`}><button className="queue-track" onClick={()=>jumpToQueuedTrack(track)}><span className="queue-index">{index+1}</span><AlbumArt track={track} size="activity"/><div><strong>{track.title}</strong><span>{track.artist} · {track.album}</span></div><small>{track.duration}</small></button><div className="queue-actions"><button disabled={index===0} title="Move up" onClick={()=>moveQueueItem(index,-1)}>↑</button><button disabled={index===queuedTracks.length-1} title="Move down" onClick={()=>moveQueueItem(index,1)}>↓</button><button title="Remove from queue" onClick={()=>removeFromQueue(track.id)}>×</button></div></div>) : <p>Your queue is empty. Playing Next will continue through your library.</p>}</div>
      </div>}

      {addMusicOpen && <div className="add-music-backdrop" onMouseDown={(event)=>{if(event.target===event.currentTarget)setAddMusicOpen(false)}}>
        <div className="add-music-modal" role="dialog" aria-modal="true" aria-label="Add music">
          <div className="add-music-head"><div><span>YOUR LIBRARY</span><h2>Add music to Reson</h2><p>Reson plays files stored on your device. Choose where they live, rescan after adding new tracks, or use an external helper if you need compatible local files.</p></div><button className="add-music-close" onClick={()=>setAddMusicOpen(false)}>×</button></div>
          <div className="add-music-options">
            <button onClick={()=>{setAddMusicOpen(false);void chooseFolder()}}><span className="add-music-icon"><Icon name="folder"/></span><div><strong>{folder?'Change music folder':'Choose music folder'}</strong><small>{folder?'Point Reson at a different local collection.':'Select the folder where your audio files are stored.'}</small></div><Icon name="forward"/></button>
            <button disabled={!folder||scanBusy} onClick={()=>{setAddMusicOpen(false);if(folder)void scanFolder(folder,false)}}><span className="add-music-icon"><Icon name="refresh"/></span><div><strong>{scanBusy?'Scanning…':'Rescan current folder'}</strong><small>{folder?'Pick up songs you added since the last scan.':'Choose a music folder first.'}</small></div><Icon name="forward"/></button>
            <button onClick={()=>void openSpotiSaver()}><span className="add-music-icon external"><Icon name="external"/></span><div><strong>Open Spotisaver</strong><small>Open the external website in your default browser, then add the resulting local files to your Reson folder.</small></div><Icon name="external"/></button>
          </div>
          <div className="add-music-note"><Icon name="discover"/><span>Spotisaver is a third-party website and is not part of Reson. Only download or copy music you have the right to use.</span></div>
        </div>
      </div>}

      {nowPlayingOpen && <NowPlayingView
        current={current}
        tracks={tracks}
        queuedTracks={queuedTracks}
        mode={nowPlayingMode}
        onMode={setNowPlayingMode}
        playing={playing}
        liked={liked}
        elapsedSeconds={elapsedSeconds}
        duration={duration}
        progress={progress}
        volume={volume}
        shuffleOn={shuffleOn}
        repeatMode={repeatMode}
        crossfade={audioSettings.crossfade}
        gapless={audioSettings.gapless}
        onClose={()=>setNowPlayingOpen(false)}
        onTogglePlayback={()=>void togglePlayback()}
        onPrevious={()=>void previousTrack()}
        onNext={nextTrack}
        onSeek={(value)=>void seek(value)}
        onVolume={setVolume}
        onShuffle={toggleShuffle}
        onRepeat={cycleRepeat}
        onLike={()=>current.path&&setLikedIds(ids=>ids.includes(current.id)?ids.filter(id=>id!==current.id):[...ids,current.id])}
        onQueueTrack={jumpToQueuedTrack}
        onRemoveQueue={removeFromQueue}
        onMoveQueue={moveQueueItem}
        onClearQueue={()=>setQueueIds([])}
      />}
      <footer className="player-panel">
        <div className="now-playing" onContextMenu={(e)=>{if(current?.path){e.preventDefault();setContextMenu({x:e.clientX,y:e.clientY,trackId:current.id})}}}><button className="now-playing-open" onClick={()=>setNowPlayingOpen(true)} title="Open Now Playing"><AlbumArt track={current} size="player"/></button><div className="now-copy" onClick={()=>setNowPlayingOpen(true)}><strong>{current.title}</strong><span>{current.artist}</span></div><button className={`like-button ${liked ? 'liked' : ''}`} onClick={() => current.path && setLikedIds((ids) => ids.includes(current.id) ? ids.filter(id => id !== current.id) : [...ids, current.id])}><Icon name="heart"/></button></div>
        <div className="player-center">
          <div className="transport"><button className={shuffleOn?'mode-active':''} title={shuffleOn?'Shuffle on':'Shuffle off'} onClick={toggleShuffle}><Icon name="shuffle"/></button><button onClick={() => void previousTrack()}><Icon name="previous"/></button><button className="main-play" onClick={() => void togglePlayback()}><Icon name={playing ? 'pause' : 'play'}/></button><button onClick={nextTrack}><Icon name="next"/></button><button className={repeatMode!=='off'?'mode-active repeat-button':''} title={`Repeat: ${repeatMode}`} onClick={cycleRepeat}><Icon name="repeat"/>{repeatMode==='one'&&<b>1</b>}</button></div>
          <div className="seek-row"><span>{formatTime(elapsedSeconds)}</span><div className="range-wrap waveform-range"><WaveformSeek track={current} progress={progress} onSeek={(value)=>void seek(value)} compact/></div><span>{formatTime(duration)}</span></div>
        </div>
        <div className="player-tools"><button onClick={() => setVolume(v => v ? 0 : 72)}><Icon name="volume"/></button><input className="volume-range" type="range" min="0" max="100" value={volume} onChange={(e)=>setVolume(Number(e.target.value))} style={{'--range-progress':`${volume}%`} as CSSProperties}/><button className={queueOpen?'tool-active':''} onClick={()=>setQueueOpen(v=>!v)}><Icon name="queue"/></button><button title="Audio settings" onClick={()=>setActive('settings')}><Icon name="device"/></button><button title="Open Now Playing" onClick={()=>setNowPlayingOpen(true)}><Icon name="expand"/></button></div>
      </footer>
    {trackDetailsId&&(()=>{const track=tracks.find(t=>t.id===trackDetailsId);if(!track)return null;return <div className="details-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setTrackDetailsId(null)}}><div className="track-details-modal"><button className="details-close" onClick={()=>setTrackDetailsId(null)}>×</button><div className="details-head"><AlbumArt track={track} size="large"/><div><span className="eyebrow">TRACK DETAILS</span><h2>{track.title}</h2><p>{track.artist}</p></div></div><div className="details-grid"><span><small>Album</small><strong>{track.album}</strong></span><span><small>Format</small><strong>{track.extension.toUpperCase()}</strong></span><span><small>Duration</small><strong>{track.duration}</strong></span><span><small>Waveform</small><strong>{track.waveform?.length?'Cached':'On demand'}</strong></span></div><div className="details-path"><small>FILE</small><code>{track.path}</code></div><div className="details-actions"><button onClick={()=>void showInExplorer(track)}><Icon name="folder"/>Show in File Explorer</button><button onClick={()=>{setTrackDetailsId(null);setDetail({type:'album',name:track.album});setActive('library')}}><Icon name="album"/>Open album</button></div></div></div>})()}
    {contextMenu && (()=>{const t=tracks.find(x=>x.id===contextMenu.trackId); if(!t)return null; return <><div className="context-dismiss" onClick={()=>setContextMenu(null)}/><div className="track-context-menu" style={{left:Math.min(contextMenu.x,window.innerWidth-230),top:Math.min(contextMenu.y,window.innerHeight-330)}}><button onClick={()=>{playTrack(t);setContextMenu(null)}}><Icon name="play"/>Play now</button><button onClick={()=>{setQueueIds(ids=>[t.id,...ids.filter(id=>id!==t.id)]);setContextMenu(null)}}><Icon name="next"/>Play next</button><button onClick={()=>{setQueueIds(ids=>ids.includes(t.id)?ids:[...ids,t.id]);setContextMenu(null)}}><Icon name="queue"/>Add to queue</button><div/><button onClick={()=>{setDetail({type:'album',name:t.album});setActive('library');setContextMenu(null)}}><Icon name="album"/>Go to album</button><button onClick={()=>{setDetail({type:'artist',name:t.artist});setActive('library');setContextMenu(null)}}><Icon name="artist"/>Go to artist</button><button onClick={()=>{setLikedIds(ids=>ids.includes(t.id)?ids.filter(id=>id!==t.id):[...ids,t.id]);setContextMenu(null)}}><Icon name="heart"/>{likedIds.includes(t.id)?'Remove from Liked':'Like song'}</button><div/><button onClick={()=>{setTrackDetailsId(t.id);setContextMenu(null)}}><Icon name="activity"/>Track details</button><button onClick={()=>{void showInExplorer(t);setContextMenu(null)}}><Icon name="folder"/>Show in File Explorer</button>{playlists.length>0&&<><div/><span className="context-label">ADD TO PLAYLIST</span>{playlists.slice(0,5).map(p=><button key={p.id} disabled={p.trackIds.includes(t.id)} onClick={()=>{addTrackToPlaylist(p.id,t.id);setContextMenu(null)}}><Icon name="playlist"/>{p.name}</button>)}</>}</div></>})()}</main>
  );
}

function cropImageStyle(crop:ImageCrop):CSSProperties{
  return {
    objectPosition:`${crop.x}% ${crop.y}%`,
    transform:`scale(${crop.zoom})`
  };
}

function getGreeting(){
  const hour=new Date().getHours();
  if(hour<5) return 'Good night';
  if(hour<12) return 'Good morning';
  if(hour<17) return 'Good afternoon';
  if(hour<22) return 'Good evening';
  return 'Good night';
}

function HomeView({tracks,demos,recentTracks,playCounts,profileName,onPlay,onContext,onImport,onNavigate}:{tracks:Track[];demos:Track[];recentTracks:Track[];playCounts:PlayCounts;profileName:string;onPlay:(track:Track)=>void;onContext:(e:React.MouseEvent,track:Track)=>void;onImport:()=>void;onNavigate:(target:LibraryView|'stats')=>void}) {
  const recent = recentTracks.length ? recentTracks.slice(0,5) : (tracks.length ? uniqueAlbums(tracks).slice(0,5) : demos);
  const top = [...tracks].sort((a,b)=>(playCounts[b.id]??0)-(playCounts[a.id]??0)).filter(t=>(playCounts[t.id]??0)>0).slice(0,5);
  const rediscover=[...tracks].filter(t=>(playCounts[t.id]??0)===0).sort((a,b)=>(a.artist+a.album+a.title).localeCompare(b.artist+b.album+b.title)).slice(0,5);
  const collection=[...tracks].slice(-5).reverse();
  const card=(track:Track,key:string,badge?:string)=><button className="album-card" key={key} onClick={()=>onPlay(track)} onContextMenu={(e)=>track.path&&onContext(e,track)}><div className="art-shell"><AlbumArt track={track} size="large"/>{badge&&<span className="play-count-badge">{badge}</span>}<span className="hover-play"><Icon name="play"/></span></div><strong>{track.title || track.album}</strong><span>{track.artist}</span></button>;
  return <div className="home-page page-enter">
    <div className="greeting"><h1>{getGreeting()}, <em>{profileName}</em></h1><p className="home-subtitle">{tracks.length?`${tracks.length} songs in your local library`:'Your music, your machine.'}</p></div>
    {!tracks.length && <div className="import-hero"><div><span className="eyebrow">WELCOME TO RESON</span><h2>Bring your music home.</h2><p>Choose the folder where you keep your music. Reson will scan it locally and build your library without uploading anything.</p></div><button onClick={onImport}><Icon name="folder"/> Choose music folder</button></div>}
    <section className="content-section"><SectionTitle title={recentTracks.length?'Continue Listening':tracks.length?'Your Albums':'Reson Preview'} onSeeAll={()=>onNavigate(recentTracks.length?'stats':tracks.length?'albums':'overview')}/><div className="recent-grid">{recent.map((t,i)=>card(t,`recent-${t.id}-${i}`))}</div></section>
    {top.length>0&&<section className="content-section"><SectionTitle title="On Repeat" onSeeAll={()=>onNavigate('stats')}/><div className="recent-grid">{top.map((t,i)=>card(t,`top-${t.id}-${i}`,`${playCounts[t.id]} plays`))}</div></section>}
    {collection.length>0&&<section className="content-section"><SectionTitle title="Recently Added" onSeeAll={()=>onNavigate('songs')}/><div className="recent-grid">{collection.map((t,i)=>card(t,`added-${t.id}-${i}`))}</div></section>}
    {rediscover.length>0&&<section className="content-section"><SectionTitle title="Rediscover" onSeeAll={()=>onNavigate('songs')}/><p className="smart-section-copy">Tracks in your library you haven't played in Reson yet.</p><div className="recent-grid">{rediscover.map((t,i)=>card(t,`rediscover-${t.id}-${i}`))}</div></section>}
  </div>;
}

function RecentActivity({tracks,history,onPlay,onContext,onOpenHistory}:{tracks:Track[];history:HistoryEntry[];onPlay:(track:Track)=>void;onContext:(e:React.MouseEvent,track:Track)=>void;onOpenHistory:()=>void}) {
  const timeFor=(id:string)=>{const entry=history.find(h=>h.trackId===id);return entry?relativeTime(entry.playedAt):''};
  const items = tracks.slice(0,7);
  return <aside className="activity-panel"><div className="activity-title"><strong>Recent Activity</strong><Icon name="activity"/></div><div className="activity-list">{items.length ? items.map((track)=><button key={track.id} onClick={()=>onPlay(track)} onContextMenu={(e)=>onContext(e,track)}><AlbumArt track={track} size="activity"/><div className="activity-copy"><strong>{track.title}</strong><small>{track.artist}</small></div><div className="activity-time"><span>{timeFor(track.id)}</span><i/></div></button>) : <div className="activity-empty"><Icon name="clock"/><strong>No listening history yet</strong><span>Play something and Reson will remember what you've been listening to.</span></div>}</div>{items.length>0&&<button className="history-button" onClick={onOpenHistory}><Icon name="clock"/>View stats</button>}</aside>;
}


function LibraryOverview({tracks,likedIds,playCounts,totalListenSeconds,onPlay,onContext,onOpen,onOpenDetail,onImport,folder}:{tracks:Track[];likedIds:string[];playCounts:PlayCounts;totalListenSeconds:number;onPlay:(track:Track,context?:Track[])=>void;onContext:(e:React.MouseEvent,track:Track)=>void;onOpen:(view:LibraryView)=>void;onOpenDetail:(type:'album'|'artist',name:string)=>void;onImport:()=>void;folder:string}) {
  const albums=uniqueAlbums(tracks);
  const artists=Array.from(new Map(tracks.map(t=>[t.artist,t])).values());
  const recent=[...tracks].slice(-5).reverse();
  const liked=tracks.filter(t=>likedIds.includes(t.id));
  if(!folder) return <div className="library-overview"><div className="page-heading"><p>YOUR COLLECTION</p><h1>Library</h1><span>Your local collection, all in one place.</span></div><div className="empty-library"><div className="feature-icon"><Icon name="library"/></div><h2>Your library is waiting</h2><p>Choose your music folder and Reson will organize your albums, artists, songs, and likes here.</p><button onClick={onImport}><Icon name="folder"/> Choose music folder</button></div></div>;
  const stat=(value:string,label:string,view?:LibraryView)=><button className="library-stat" onClick={()=>view&&onOpen(view)}><strong>{value}</strong><span>{label}</span></button>;
  return <div className="library-overview page-enter">
    <div className="library-overview-hero"><div><span className="eyebrow">YOUR COLLECTION</span><h1>Library</h1><p>{tracks.length} songs across {albums.length} albums and {artists.length} artists.</p></div><button onClick={()=>onOpen('songs')}><Icon name="song"/> Browse all songs</button></div>
    <div className="library-stat-grid">
      {stat(String(tracks.length),'Songs','songs')}
      {stat(String(albums.length),'Albums','albums')}
      {stat(String(artists.length),'Artists','artists')}
      {stat(String(liked.length),'Liked','liked')}
      {stat(formatListenTime(totalListenSeconds),'Listening')}
    </div>
    {recent.length>0&&<section className="content-section"><div className="section-title"><h2>Recently Added</h2><button onClick={()=>onOpen('songs')}>See all</button></div><div className="recent-grid">{recent.map((track,i)=><button className="album-card" key={`lib-recent-${track.id}-${i}`} onClick={()=>onPlay(track,tracks)} onContextMenu={(e)=>onContext(e,track)}><div className="art-shell"><AlbumArt track={track} size="large"/><span className="hover-play"><Icon name="play"/></span></div><strong>{track.title}</strong><span>{track.artist}</span></button>)}</div></section>}
    {albums.length>0&&<section className="content-section"><div className="section-title"><h2>Albums</h2><button onClick={()=>onOpen('albums')}>See all</button></div><div className="library-preview-grid">{albums.slice(0,5).map(track=><button className="album-card" key={`lib-album-${track.album}-${track.artist}`} onClick={()=>onOpenDetail('album',track.album)}><div className="art-shell"><AlbumArt track={track} size="large"/></div><strong>{track.album}</strong><span>{track.artist}</span></button>)}</div></section>}
    {artists.length>0&&<section className="content-section"><div className="section-title"><h2>Artists</h2><button onClick={()=>onOpen('artists')}>See all</button></div><div className="library-artist-row">{artists.slice(0,6).map(track=><button key={`lib-artist-${track.artist}`} onClick={()=>onOpenDetail('artist',track.artist)}><AlbumArt track={track} size="large"/><strong>{track.artist}</strong><span>{tracks.filter(t=>t.artist===track.artist).length} songs</span></button>)}</div></section>}
  </div>;
}

function LibraryPage({selected,tracks,onPlay,onImport,onMusicHelper,folder,scanBusy,onRescan,likedIds,onOpenDetail,onContext,sort,onSort,playCounts,selectedTrackIds,onSelection,playlists,onBulkLike,onBulkQueue,onBulkPlaylist}:{selected:LibraryView;tracks:Track[];onPlay:(track:Track,context?:Track[])=>void;onImport:()=>void;onMusicHelper:()=>void;folder:string;scanBusy:boolean;onRescan:()=>void;likedIds:string[];onOpenDetail:(type:'album'|'artist',name:string)=>void;onContext:(e:React.MouseEvent,track:Track)=>void;sort:LibrarySort;onSort:(sort:LibrarySort)=>void;playCounts:PlayCounts;selectedTrackIds:string[];onSelection:(ids:string[])=>void;playlists:Playlist[];onBulkLike:()=>void;onBulkQueue:()=>void;onBulkPlaylist:(playlistId:string,trackIds:string[])=>void}) {
  const base = selected === 'liked' ? tracks.filter(t=>likedIds.includes(t.id)) : tracks;
  const shown = [...base].sort((a,b)=>{
    if(sort==='artist') return a.artist.localeCompare(b.artist)||a.title.localeCompare(b.title);
    if(sort==='album') return a.album.localeCompare(b.album)||a.title.localeCompare(b.title);
    if(sort==='mostPlayed') return (playCounts[b.id]??0)-(playCounts[a.id]??0)||a.title.localeCompare(b.title);
    if(sort==='duration') return b.durationSeconds-a.durationSeconds;
    return a.title.localeCompare(b.title);
  });
  const title = selected === 'liked' ? 'Liked Songs' : selected === 'overview' ? 'Library' : selected.charAt(0).toUpperCase()+selected.slice(1);
  if (!folder) return <div className="library-page"><div className="page-heading"><p>YOUR COLLECTION</p><h1>{title}</h1><span>Your local music will live here.</span></div><div className="empty-library"><div className="feature-icon"><Icon name="folder"/></div><h2>Start your Reson library</h2><p>Select a folder containing MP3, FLAC, WAV, OGG, M4A, AAC, OPUS or AIFF files. Reson scans subfolders automatically.</p><div className="empty-library-actions"><button onClick={onImport}><Icon name="plus"/> Add music folder</button><button className="helper-secondary" onClick={onMusicHelper}><Icon name="external"/> Music Helper</button></div></div></div>;
  const cards=groupCards(shown,selected);
  return <div className="library-page"><div className="page-heading library-heading-row"><div><p>YOUR COLLECTION</p><h1>{title}</h1><span>{shown.length} track{shown.length===1?'':'s'} · {folder}</span></div><div className="library-heading-actions"><label className="sort-control"><span>Sort</span><select value={sort} onChange={e=>onSort(e.target.value as LibrarySort)}><option value="title">Title</option><option value="artist">Artist</option><option value="album">Album</option><option value="mostPlayed">Most Played</option><option value="duration">Duration</option></select></label><button className="music-helper-inline" onClick={onMusicHelper}><Icon name="external"/>Music Helper</button><button className="rescan-button" onClick={onRescan} disabled={scanBusy}><Icon name="refresh"/>{scanBusy?'Scanning…':'Rescan'}</button></div></div>{shown.length===0?<div className="search-empty"><Icon name="search"/><h2>No music found</h2><p>Try a different title, artist, or album.</p></div>:selected==='songs'||selected==='liked'?<><SelectionToolbar selectedIds={selectedTrackIds} tracks={shown} likedIds={likedIds} playlists={playlists} onClear={()=>onSelection([])} onLike={onBulkLike} onQueue={onBulkQueue} onPlaylist={(id)=>onBulkPlaylist(id,selectedTrackIds)}/><TrackTable tracks={shown} onPlay={onPlay} likedIds={likedIds} onContext={onContext} selectedIds={selectedTrackIds} onSelection={onSelection}/></>:<div className="library-grid">{cards.map(track=>{const label=selected==='artists'?track.artist:track.album; const group=shown.filter(t=>(selected==='artists'?t.artist:t.album)===label); return <button className="album-card library-card" key={`${selected}-${label}`} onClick={()=>selected==='albums'?onOpenDetail('album',track.album):selected==='artists'?onOpenDetail('artist',track.artist):onPlay(track,group)}><div className="art-shell"><AlbumArt track={track} size="large"/><span className="hover-play"><Icon name={selected==='artists'?'artist':'album'}/></span></div><strong>{label}</strong><span>{selected==='artists'?`${group.length} songs`:track.artist}</span><small>{group.length} track{group.length===1?'':'s'}</small></button>})}</div>}</div>;
}

function NowPlayingView({current,tracks,queuedTracks,mode,onMode,playing,liked,elapsedSeconds,duration,progress,volume,shuffleOn,repeatMode,crossfade,gapless,onClose,onTogglePlayback,onPrevious,onNext,onSeek,onVolume,onShuffle,onRepeat,onLike,onQueueTrack,onRemoveQueue,onMoveQueue,onClearQueue}:{current:Track;tracks:Track[];queuedTracks:Track[];mode:NowPlayingMode;onMode:(mode:NowPlayingMode)=>void;playing:boolean;liked:boolean;elapsedSeconds:number;duration:number;progress:number;volume:number;shuffleOn:boolean;repeatMode:RepeatMode;crossfade:number;gapless:boolean;onClose:()=>void;onTogglePlayback:()=>void;onPrevious:()=>void;onNext:()=>void;onSeek:(value:number)=>void;onVolume:(value:number)=>void;onShuffle:()=>void;onRepeat:()=>void;onLike:()=>void;onQueueTrack:(track:Track)=>void;onRemoveQueue:(id:string)=>void;onMoveQueue:(index:number,direction:-1|1)=>void;onClearQueue:()=>void}) {
  const upcoming=queuedTracks.slice(0,12);
  const artUrl=current.artworkPath?convertFileSrc(current.artworkPath):null;
  const albumCount=tracks.filter(t=>t.album===current.album).length;

  const transport=<>
    <div className="np-seek"><WaveformSeek track={current} progress={progress} onSeek={onSeek}/><div><span>{formatTime(elapsedSeconds)}</span><span>{formatTime(duration)}</span></div></div>
    <div className="np-controls">
      <button className={shuffleOn?'active':''} onClick={onShuffle} title="Shuffle"><Icon name="shuffle"/></button>
      <button onClick={onPrevious}><Icon name="previous"/></button>
      <button className="np-main-play" onClick={onTogglePlayback}><Icon name={playing?'pause':'play'}/></button>
      <button onClick={onNext}><Icon name="next"/></button>
      <button className={repeatMode!=='off'?'active':''} onClick={onRepeat} title={`Repeat ${repeatMode}`}><Icon name="repeat"/>{repeatMode==='one'&&<b>1</b>}</button>
    </div>
  </>;

  return <div className={`now-playing-view np-mode-${mode} tone-${current.tone}`}>
    {artUrl&&<div className="np-art-backdrop" style={{backgroundImage:`url("${artUrl}")`}}/>}
    <div className="np-gradient"/>
    <header className="np-header">
      <div className="np-brand"><span className="brand-mark mini"><b>R</b></span><strong>Now Playing</strong></div>
      <div className="np-mode-switch">
        <button className={mode==='artwork'?'active':''} onClick={()=>onMode('artwork')}>Artwork <kbd>A</kbd></button>
        <button className={mode==='ambient'?'active':''} onClick={()=>onMode('ambient')}>Ambient <kbd>V</kbd></button>
        <button className={mode==='queue'?'active':''} onClick={()=>onMode('queue')}>Queue <kbd>Q</kbd></button>
      </div>
      <button className="np-close" onClick={onClose} title="Close Now Playing">×</button>
    </header>

    {mode==='artwork'&&<div className="np-layout">
      <section className="np-main">
        <div className="np-artwork"><AlbumArt track={current} size="large"/><span className={`np-live ${playing?'playing':''}`}><i/><b>{playing?'PLAYING':'PAUSED'}</b></span></div>
        <div className="np-meta">
          <div className="np-title-row"><div><span className="eyebrow">NOW PLAYING</span><h1>{current.title}</h1><h2>{current.artist}</h2></div><button className={`np-like ${liked?'liked':''}`} onClick={onLike}><Icon name="heart"/></button></div>
          <div className="np-album-line"><span>{current.album}</span><i/> <span>{current.extension.toUpperCase()}</span></div>
          {transport}
          <div className="np-lower">
            <div className="np-volume"><Icon name="volume"/><input type="range" min="0" max="100" value={volume} onChange={e=>onVolume(Number(e.target.value))} style={{'--range-progress':`${volume}%`} as CSSProperties}/><b>{volume}%</b></div>
            <div className="np-badges"><span>{albumCount} track{albumCount===1?'':'s'} on album</span><span>{crossfade>0?`${crossfade}s crossfade`:gapless?'Gapless on':'Standard transition'}</span></div>
          </div>
        </div>
      </section>
      <aside className="np-queue">
        <div className="np-queue-head"><div><span className="eyebrow">QUEUE</span><h3>Up Next</h3></div><span>{queuedTracks.length} remaining</span></div>
        {upcoming.length?<div className="np-queue-list">{upcoming.slice(0,8).map((track,index)=><button key={track.id} onClick={()=>onQueueTrack(track)}><span className="np-q-index">{index+1}</span><AlbumArt track={track} size="activity"/><div><strong>{track.title}</strong><small>{track.artist} · {track.album}</small></div><em>{track.duration}</em></button>)}</div>:<div className="np-empty-queue"><Icon name="queue"/><strong>Queue is empty</strong><span>Choose another song or let the current context continue.</span></div>}
      </aside>
    </div>}

    {mode==='ambient'&&<div className="np-ambient-mode">
      <div className="ambient-centerpiece">
        <div className="ambient-orbit" aria-hidden="true"><i/><i/><i/><i/></div>
        <div className="ambient-disc"><AlbumArt track={current} size="large"/><div className={`ambient-pulse ${playing?'playing':''}`}/></div>
      </div>
      <div className="ambient-copy"><span className="eyebrow">{playing?'PLAYING':'PAUSED'}</span><h1>{current.title}</h1><h2>{current.artist}</h2><p>{current.album}</p></div>
      <div className="ambient-bars" aria-hidden="true">{Array.from({length:52}).map((_,i)=><i key={i} style={{'--bar':`${18+((i*17)%74)}%`,'--delay':`${(i%13)*-0.08}s`} as CSSProperties}/>)}</div>
      <div className="ambient-transport">{transport}</div>
      <div className="ambient-footer"><span>{crossfade>0?`Crossfade ${crossfade}s`:gapless?'Gapless transition':'Standard transition'}</span><span>{current.extension.toUpperCase()}</span></div>
    </div>}

    {mode==='queue'&&<div className="np-queue-mode">
      <section className="np-queue-current">
        <div className="np-queue-current-art"><AlbumArt track={current} size="large"/></div>
        <div><span className="eyebrow">CURRENTLY PLAYING</span><h1>{current.title}</h1><h2>{current.artist}</h2><p>{current.album}</p></div>
        <div className="np-queue-transport">{transport}</div>
      </section>
      <section className="np-full-queue">
        <div className="np-full-queue-head"><div><span className="eyebrow">UP NEXT</span><h2>Queue</h2><p>{queuedTracks.length} song{queuedTracks.length===1?'':'s'} remaining</p></div>{queuedTracks.length>0&&<button onClick={onClearQueue}>Clear queue</button>}</div>
        {queuedTracks.length?<div className="np-full-queue-list">{queuedTracks.map((track,index)=><div className="np-full-queue-row" key={`${track.id}-${index}`}>
          <button className="np-full-main" onClick={()=>onQueueTrack(track)}><span>{index+1}</span><AlbumArt track={track} size="activity"/><div><strong>{track.title}</strong><small>{track.artist} · {track.album}</small></div><em>{track.duration}</em></button>
          <div className="np-full-actions"><button disabled={index===0} onClick={()=>onMoveQueue(index,-1)}>↑</button><button disabled={index===queuedTracks.length-1} onClick={()=>onMoveQueue(index,1)}>↓</button><button onClick={()=>onRemoveQueue(track.id)}>×</button></div>
        </div>)}</div>:<div className="np-empty-queue large"><Icon name="queue"/><strong>Nothing queued</strong><span>Your next songs will appear here.</span></div>}
      </section>
    </div>}
  </div>;
}



function ProfilePage({profileName,profilePicture,profileBanner,avatarCrop,bannerCrop,profileBio,showcase,tracks,playlists,playCounts,totalListenSeconds,likedCount,current,playing,elapsedSeconds,duration,recentTracks,dailyListenSeconds,onName,onBio,onShowcase,onPicture,onEditPicture,onRemovePicture,onBanner,onEditBanner,onRemoveBanner,onPlay,onPlaylist}:{profileName:string;profilePicture:string;profileBanner:string;avatarCrop:ImageCrop;bannerCrop:ImageCrop;profileBio:string;showcase:ShowcaseItem[];tracks:Track[];playlists:Playlist[];playCounts:PlayCounts;totalListenSeconds:number;likedCount:number;current:Track|null;playing:boolean;elapsedSeconds:number;duration:number;recentTracks:Track[];dailyListenSeconds:DailyListenSeconds;onName:(name:string)=>void;onBio:(bio:string)=>void;onShowcase:React.Dispatch<React.SetStateAction<ShowcaseItem[]>>;onPicture:()=>void;onEditPicture:()=>void;onRemovePicture:()=>void;onBanner:()=>void;onEditBanner:()=>void;onRemoveBanner:()=>void;onPlay:(track:Track,context?:Track[])=>void;onPlaylist:(id:string)=>void}) {
  const [editingShowcase,setEditingShowcase]=useState(false);
  const initials=profileName.split(/\s+/).filter(Boolean).map(part=>part[0]).join('').slice(0,2).toUpperCase()||'R';
  const artists=useMemo(()=>Array.from(new Set(tracks.map(t=>t.artist))).sort((a,b)=>a.localeCompare(b)),[tracks]);
  const albums=useMemo(()=>Array.from(new Map(tracks.map(t=>[`${t.artist}|||${t.album}`,t])).values()).sort((a,b)=>a.album.localeCompare(b.album)),[tracks]);
  const topArtist=useMemo(()=>{
    const counts=new Map<string,number>();
    for(const track of tracks)counts.set(track.artist,(counts.get(track.artist)??0)+(playCounts[track.id]??0));
    return [...counts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||'No listening data yet';
  },[tracks,playCounts]);
  const weekSeconds=useMemo(()=>currentWeekListening(dailyListenSeconds).reduce((sum,day)=>sum+day.seconds,0),[dailyListenSeconds]);

  const resolveShowcase=(item:ShowcaseItem)=>{
    if(item.kind==='track'){
      const track=tracks.find(t=>t.id===item.value); if(!track)return null;
      return {track,title:track.title,sub:track.artist,label:'SONG'};
    }
    if(item.kind==='artist'){
      const track=tracks.find(t=>t.artist===item.value); if(!track)return null;
      return {track,title:item.value,sub:`${tracks.filter(t=>t.artist===item.value).length} songs in library`,label:'ARTIST'};
    }
    if(item.kind==='album'){
      const track=albums.find(t=>`${t.artist}|||${t.album}`===item.value); if(!track)return null;
      return {track,title:track.album,sub:track.artist,label:'ALBUM'};
    }
    const playlist=playlists.find(p=>p.id===item.value); if(!playlist)return null;
    const track=playlist.trackIds.map(id=>tracks.find(t=>t.id===id)).find((t):t is Track=>!!t)??null;
    return {track,playlist,title:playlist.name,sub:`${playlist.trackIds.length} songs`,label:'PLAYLIST'};
  };

  const openShowcase=(item:ShowcaseItem)=>{
    const resolved=resolveShowcase(item); if(!resolved)return;
    if(item.kind==='playlist'&&resolved.playlist){onPlaylist(resolved.playlist.id);return;}
    if(item.kind==='artist'){
      if(resolved.track)onPlay(resolved.track,tracks.filter(t=>t.artist===item.value));
      return;
    }
    if(item.kind==='album'&&resolved.track){
      onPlay(resolved.track,tracks.filter(t=>`${t.artist}|||${t.album}`===item.value));
      return;
    }
    if(resolved.track)onPlay(resolved.track,tracks);
  };

  const addShowcase=()=>{
    if(showcase.length>=6)return;
    const first=tracks[0];
    onShowcase(items=>[...items,{id:`showcase-${Date.now()}`,kind:'track' as ShowcaseKind,value:first?.id??''}].slice(0,6));
  };
  const updateShowcase=(id:string,patch:Partial<ShowcaseItem>)=>onShowcase(items=>items.map(item=>item.id===id?{...item,...patch}:item));
  const moveShowcase=(index:number,dir:-1|1)=>onShowcase(items=>{const next=[...items];const to=index+dir;if(to<0||to>=next.length)return items;[next[index],next[to]]=[next[to],next[index]];return next;});
  const removeShowcase=(id:string)=>onShowcase(items=>items.filter(item=>item.id!==id));

  const optionsFor=(kind:ShowcaseKind)=>{
    if(kind==='artist')return artists.map(v=>({value:v,label:v}));
    if(kind==='album')return albums.map(t=>({value:`${t.artist}|||${t.album}`,label:`${t.album} — ${t.artist}`}));
    if(kind==='playlist')return playlists.map(p=>({value:p.id,label:p.name}));
    return tracks.map(t=>({value:t.id,label:`${t.title} — ${t.artist}`}));
  };

  const currentProgress=duration>0?Math.min(100,(elapsedSeconds/duration)*100):0;
  const recent=recentTracks.filter(t=>t.path).slice(0,6);

  return <div className="profile-page page-enter">
    <section className="profile-hero">
      <div className={`profile-banner ${profileBanner?'has-image':''}`}>
        {profileBanner&&<img className="profile-banner-image" src={resonImageSrc(profileBanner)} alt="" style={cropImageStyle(bannerCrop)}/>}
        <div className="profile-banner-shade"/>
        <div className="profile-banner-actions"><button onClick={onBanner}><Icon name="album"/>{profileBanner?'Change image':'Add banner'}</button>{profileBanner&&<button onClick={onEditBanner}><Icon name="activity"/>Crop / position</button>}{profileBanner&&<button onClick={onRemoveBanner}>Remove</button>}</div>
      </div>
      <div className="profile-identity">
        <button className="profile-page-avatar" onClick={profilePicture?onEditPicture:onPicture} title={profilePicture?'Crop profile picture':'Choose profile picture'}>{profilePicture?<img src={resonImageSrc(profilePicture)} alt="" style={cropImageStyle(avatarCrop)}/>:<span>{initials}</span>}<i><Icon name="album"/></i></button>
        <div className="profile-identity-copy"><input className="profile-name-input" value={profileName} maxLength={40} onChange={e=>onName(e.target.value)} aria-label="Profile name"/><textarea value={profileBio} maxLength={180} onChange={e=>onBio(e.target.value)} placeholder="Add a short bio or status…" aria-label="Profile bio"/><small>{profileBio.length}/180</small></div>
        <div className="profile-image-actions"><button onClick={onPicture}>{profilePicture?'Change image':'Add avatar'}</button>{profilePicture&&<button onClick={onEditPicture}>Crop / position</button>}{profilePicture&&<button onClick={onRemovePicture}>Remove avatar</button>}</div>
      </div>
    </section>

    <div className="profile-stat-strip">
      <span><strong>{formatListenTime(weekSeconds)}</strong><small>THIS WEEK</small></span>
      <span><strong>{formatListenTime(totalListenSeconds)}</strong><small>ALL TIME</small></span>
      <span><strong>{tracks.length}</strong><small>SONGS</small></span>
      <span><strong>{likedCount}</strong><small>LIKED</small></span>
      <span><strong title={topArtist}>{topArtist}</strong><small>TOP ARTIST</small></span>
    </div>

    <section className="profile-now-section">
      <div className="section-title"><div><h2>Currently Listening</h2><p>Your live Reson playback status.</p></div></div>
      {current?<button className="profile-now-card" onClick={()=>onPlay(current,tracks)}>
        <AlbumArt track={current} size="large"/>
        <div className="profile-now-copy"><span className={`profile-live-pill ${playing?'playing':''}`}><i/>{playing?'PLAYING NOW':'PAUSED'}</span><h3>{current.title}</h3><p>{current.artist} · {current.album}</p><div className="profile-now-progress"><i style={{width:`${currentProgress}%`}}/></div><small>{formatTime(elapsedSeconds)} / {formatTime(duration)}</small></div>
        <span className="profile-now-action"><Icon name={playing?'activity':'play'}/></span>
      </button>:<div className="profile-empty-card"><Icon name="song"/><div><strong>Nothing playing right now</strong><span>Start a song and it will appear here.</span></div></div>}
    </section>

    <section className="profile-section">
      <div className="section-title profile-showcase-title"><div><h2>Your Showcase</h2><p>Feature the music and playlists that say the most about you.</p></div><button onClick={()=>setEditingShowcase(true)}><Icon name="settings"/>Edit showcase</button></div>
      {showcase.length?<div className="profile-showcase-grid profile-showcase-new">{showcase.map((item,index)=>{
        const resolved=resolveShowcase(item);
        if(!resolved)return <div className="showcase-card missing" key={item.id}><span className="showcase-placeholder"><Icon name="song"/></span><small>{item.kind.toUpperCase()}</small><strong>Unavailable item</strong><em>Edit this showcase slot</em></div>;
        return <button className={index===0?'featured':''} key={item.id} onClick={()=>openShowcase(item)}>
          {resolved.playlist?.coverPath?<span className="showcase-image"><img src={resonImageSrc(resolved.playlist.coverPath)} alt=""/></span>:resolved.track?<AlbumArt track={resolved.track} size="large"/>:<span className="showcase-placeholder"><Icon name={item.kind==='artist'?'artist':item.kind==='playlist'?'playlist':item.kind==='album'?'album':'song'}/></span>}
          <small>{index===0?'FEATURED ':''}{resolved.label}</small><strong>{resolved.title}</strong><em>{resolved.sub}</em>
        </button>;
      })}</div>:<button className="profile-empty-showcase" onClick={()=>setEditingShowcase(true)}><Icon name="plus"/><strong>Build your showcase</strong><span>Pick up to six songs, artists, albums, or playlists to feature here.</span></button>}
    </section>

    <section className="profile-section">
      <div className="section-title"><div><h2>Recently Played</h2><p>The music you've been coming back to lately.</p></div></div>
      {recent.length?<div className="profile-recent-strip">{recent.map(track=><button key={track.id} onClick={()=>onPlay(track,tracks)}><AlbumArt track={track} size="large"/><strong>{track.title}</strong><span>{track.artist}</span></button>)}</div>:<div className="profile-empty-card compact"><Icon name="clock"/><div><strong>No recent plays yet</strong><span>Your recent listening will show up here.</span></div></div>}
    </section>

    {editingShowcase&&<div className="showcase-editor-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setEditingShowcase(false)}}>
      <div className="showcase-editor">
        <div className="showcase-editor-head"><div><span className="eyebrow">PROFILE CUSTOMIZATION</span><h2>Edit Showcase</h2><p>Choose up to six items and arrange them in the order you want people to see them.</p></div><button onClick={()=>setEditingShowcase(false)}>×</button></div>
        <div className="showcase-editor-list">
          {showcase.map((item,index)=>{
            const options=optionsFor(item.kind);
            return <div className="showcase-editor-row" key={item.id}>
              <b>{index+1}</b>
              <select className="showcase-kind" value={item.kind} onChange={e=>{const kind=e.target.value as ShowcaseKind;const first=optionsFor(kind)[0]?.value??'';updateShowcase(item.id,{kind,value:first})}}><option value="track">Song</option><option value="artist">Artist</option><option value="album">Album</option><option value="playlist">Playlist</option></select>
              <select className="showcase-value" value={item.value} onChange={e=>updateShowcase(item.id,{value:e.target.value})}>{options.length?<>{options.map(o=><option value={o.value} key={o.value}>{o.label}</option>)}</>:<option value="">Nothing available</option>}</select>
              <div className="showcase-order"><button disabled={index===0} onClick={()=>moveShowcase(index,-1)}>↑</button><button disabled={index===showcase.length-1} onClick={()=>moveShowcase(index,1)}>↓</button><button className="remove" onClick={()=>removeShowcase(item.id)}>×</button></div>
            </div>;
          })}
        </div>
        <div className="showcase-editor-actions"><button disabled={showcase.length>=6||!tracks.length} onClick={addShowcase}><Icon name="plus"/>Add showcase item</button><span>{showcase.length}/6 slots used</span><button className="done" onClick={()=>setEditingShowcase(false)}>Done</button></div>
      </div>
    </div>}
  </div>;
}

function SettingsPage({volume,setVolume,settings,setSettings,folder,onChangeFolder,background,setBackground,onChooseBackground,diagnostics}:{volume:number;setVolume:(v:number)=>void;settings:{crossfade:number;normalization:boolean;preamp:number;bass:number;mids:number;treble:number;gapless:boolean};setSettings:React.Dispatch<React.SetStateAction<{crossfade:number;normalization:boolean;preamp:number;bass:number;mids:number;treble:number;gapless:boolean}>>;folder:string;onChangeFolder:()=>void;background:AppBackgroundSettings;setBackground:React.Dispatch<React.SetStateAction<AppBackgroundSettings>>;onChooseBackground:()=>void;diagnostics:{trackCount:number;queueSize:number;currentWaveformSamples:number;lastScanMs:number|null}}) {
  const slider=(key:'preamp'|'bass'|'mids'|'treble',label:string)=>{const value=settings[key];const pct=((value+12)/24)*100;return <div className="eq-slider"><div><strong>{label}</strong><span>{value>0?'+':''}{value} dB</span></div><input className="settings-range" type="range" min="-12" max="12" step="1" value={value} onChange={e=>setSettings(s=>({...s,[key]:Number(e.target.value)}))} style={{'--range-progress':`${pct}%`} as CSSProperties}/></div>};
  return <div className="settings-page"><div className="page-heading"><p>RESON</p><h1>Settings</h1><span>Tune playback and make Reson look and sound the way you want.</span></div>
    <section className="settings-card"><div className="settings-card-head"><div><span className="settings-icon"><Icon name="album"/></span><div><h2>Appearance</h2><p>Use Reson's atmosphere or make the app your own.</p></div></div></div>
      <div className="setting-row"><div><strong>App background</strong><small>Keep Reson Default, or place your own image behind the glass UI.</small></div><div className="background-mode-switch"><button className={background.mode==='default'?'active':''} onClick={()=>setBackground(bg=>({...bg,mode:'default'}))}>Reson Default</button><button className={background.mode==='custom'?'active':''} onClick={()=>background.path?setBackground(bg=>({...bg,mode:'custom'})):onChooseBackground()}>Custom Image</button></div></div>
      {background.mode==='custom'&&<><div className="setting-row"><div><strong>Background image</strong><small>{background.path?background.path.split(/[\\/]/).pop():'Choose a JPG, PNG or WebP image.'}</small></div><div className="background-file-actions"><button onClick={onChooseBackground}>{background.path?'Change':'Choose'} image</button>{background.path&&<button onClick={()=>setBackground(bg=>({...bg,path:'',mode:'default'}))}>Remove</button>}</div></div>
      <div className="setting-row"><div><strong>Background blur</strong><small>Soften the image behind Reson while preserving its colors.</small></div><div className="setting-range compact"><input className="settings-range" type="range" min="0" max="40" value={background.blur} onChange={e=>setBackground(bg=>({...bg,blur:Number(e.target.value)}))} style={{'--range-progress':`${(background.blur/40)*100}%`} as CSSProperties}/><b>{background.blur}px</b></div></div>
      <div className="setting-row"><div><strong>Background dim</strong><small>Darken the image so text and controls remain comfortable to read.</small></div><div className="setting-range compact"><input className="settings-range" type="range" min="25" max="90" value={background.dim} onChange={e=>setBackground(bg=>({...bg,dim:Number(e.target.value)}))} style={{'--range-progress':`${((background.dim-25)/65)*100}%`} as CSSProperties}/><b>{background.dim}%</b></div></div>
      <div className="setting-row"><div><strong>Text contrast</strong><small>Brighten muted text over custom wallpapers without making the whole interface darker.</small></div><div className="background-mode-switch"><button className={background.textContrast==='normal'?'active':''} onClick={()=>setBackground(bg=>({...bg,textContrast:'normal'}))}>Normal</button><button className={background.textContrast==='strong'?'active':''} onClick={()=>setBackground(bg=>({...bg,textContrast:'strong'}))}>Strong</button></div></div></>}</section>
    <section className="settings-card"><div className="settings-card-head"><div><span className="settings-icon"><Icon name="volume"/></span><div><h2>Playback</h2><p>Volume, transitions and consistent loudness.</p></div></div></div>
      <div className="setting-row"><div><strong>Master volume</strong><small>Reson's playback volume. 100% is intentionally capped below raw device maximum for safer listening.</small></div><div className="setting-range"><input className="settings-range" type="range" min="0" max="100" value={volume} onChange={e=>setVolume(Number(e.target.value))} style={{'--range-progress':`${volume}%`} as CSSProperties}/><b>{volume}%</b></div></div>
      <div className="setting-row"><div><strong>Gapless queue</strong><small>Pre-queue the next track in Rodio so playback continues without a frontend restart.</small></div><button className={`toggle ${settings.gapless?'on':''}`} onClick={()=>setSettings(s=>({...s,gapless:!s.gapless}))}><i/></button></div>
      <div className="setting-row"><div><strong>Crossfade</strong><small>Overlap the end of one song with the beginning of the next.</small></div><div className="setting-range compact"><input className="settings-range" type="range" min="0" max="12" value={settings.crossfade} onChange={e=>setSettings(s=>({...s,crossfade:Number(e.target.value)}))} style={{'--range-progress':`${(settings.crossfade/12)*100}%`} as CSSProperties}/><b>{settings.crossfade}s</b></div></div>
      <div className="setting-row"><div><strong>Normalization</strong><small>Reduce large loudness differences between tracks.</small></div><button className={`toggle ${settings.normalization?'on':''}`} onClick={()=>setSettings(s=>({...s,normalization:!s.normalization}))}><i/></button></div>
    </section>
    <section className="settings-card"><div className="settings-card-head"><div><span className="settings-icon"><Icon name="activity"/></span><div><h2>Equalizer</h2><p>Native three-band DSP applied directly to the audio stream.</p></div></div><button className="reset-eq" onClick={()=>setSettings(s=>({...s,preamp:0,bass:0,mids:0,treble:0}))}>Reset</button></div><div className="eq-grid">{slider('preamp','Preamp')}{slider('bass','Bass')}{slider('mids','Mids')}{slider('treble','Treble')}</div><div className="eq-note">Bass, mids and treble use real biquad filters in the Rust playback stream. Preamp runs before the filters, with a safety limiter after them.</div></section>
    <section className="settings-card"><div className="settings-card-head"><div><span className="settings-icon"><Icon name="folder"/></span><div><h2>Library</h2><p>Where Reson finds your local music.</p></div></div></div><div className="setting-row"><div className="folder-setting"><strong>Music folder</strong><small>{folder||'No folder selected'}</small></div><button className="settings-action" onClick={onChangeFolder}>Manage</button></div></section>
    <section className="settings-card release-readiness-card"><div className="settings-card-head"><div><span className="settings-icon"><Icon name="settings"/></span><div><h2>Troubleshooting</h2><p>Recovery tools for Reson without touching your music files.</p></div></div><span className="release-badge">RELEASE READINESS</span></div>
      <div className="setting-row"><div><strong>Reset playback session</strong><small>Forget the last song, timestamp, queue and playback restore state. Your library, playlists, likes and listening stats stay intact.</small></div><button className="settings-action" onClick={()=>{localStorage.removeItem('reson.playbackSession');window.dispatchEvent(new CustomEvent('reson:session-cleared'));}}>Reset session</button></div>
      <div className="setting-row"><div><strong>Clear temporary caches</strong><small>Remove Reson-generated waveform and temporary UI cache entries. Music files and personal data are not deleted.</small></div><button className="settings-action" onClick={()=>{Object.keys(localStorage).filter(k=>k.startsWith('reson.waveform')||k.startsWith('reson.cache')||k.startsWith('reson.temp')).forEach(k=>localStorage.removeItem(k));}}>Clear caches</button></div>
      <div className="setting-row"><div><strong>Rescan library</strong><small>Pick up added, moved or removed music. Missing playlist references are preserved instead of being deleted, so temporarily disconnected files can recover later.</small></div><button className="settings-action" onClick={onChangeFolder}>Rescan / manage</button></div>
      <div className="diagnostics-panel">
        <div><small>TRACKS INDEXED</small><strong>{diagnostics.trackCount.toLocaleString()}</strong></div>
        <div><small>QUEUE SIZE</small><strong>{diagnostics.queueSize.toLocaleString()}</strong></div>
        <div><small>ACTIVE WAVEFORM</small><strong>{diagnostics.currentWaveformSamples?`${diagnostics.currentWaveformSamples} samples`:'Not loaded'}</strong></div>
        <div><small>LAST SCAN</small><strong>{diagnostics.lastScanMs===null?'Not recorded':diagnostics.lastScanMs<1000?`${diagnostics.lastScanMs} ms`:`${(diagnostics.lastScanMs/1000).toFixed(2)} s`}</strong></div>
      </div>
      <div className="recovery-note"><Icon name="activity"/><span>These recovery actions never modify or delete the original audio files in your music folder.</span></div>
    </section>
  </div>;
}

function AlbumDetail({name,tracks,likedIds,playCounts,onBack,onPlay,onArtist,onContext}:{name:string;tracks:Track[];likedIds:string[];playCounts:PlayCounts;onBack:()=>void;onPlay:(track:Track,context?:Track[])=>void;onArtist:(name:string)=>void;onContext:(e:React.MouseEvent,track:Track)=>void}) {
  const albumTracks=tracks.filter(t=>t.album===name).sort((a,b)=>a.path.localeCompare(b.path,undefined,{numeric:true}));
  const lead=albumTracks[0]; if(!lead) return null;
  const total=albumTracks.reduce((n,t)=>n+t.durationSeconds,0);
  return <div className="detail-page album-detail"><button className="detail-back" onClick={onBack}><Icon name="back"/> Back to albums</button><div className="detail-hero"><div className="detail-art"><AlbumArt track={lead} size="large"/></div><div className="detail-copy"><span className="eyebrow">ALBUM</span><h1>{name}</h1><button className="artist-link" onClick={()=>onArtist(lead.artist)}>{lead.artist}</button><p>{albumTracks.length} songs · {formatLongDuration(total)}</p><div className="detail-actions"><button className="hero-play" onClick={()=>onPlay(albumTracks[0],albumTracks)}><Icon name="play"/> Play</button><button onClick={()=>onPlay(shuffleArray(albumTracks)[0],shuffleArray(albumTracks))}><Icon name="shuffle"/> Shuffle</button></div></div></div><div className="detail-tracklist">{albumTracks.map((track,i)=><div className="detail-track" key={track.id} onDoubleClick={()=>onPlay(track,albumTracks)} onContextMenu={(e)=>onContext(e,track)}><button className="detail-track-play" onClick={()=>onPlay(track,albumTracks)}><span>{i+1}</span><div><strong>{track.title}{likedIds.includes(track.id)&&<b className="mini-heart">♥</b>}</strong><small>{track.artist}</small></div></button><span className="detail-plays">{playCounts[track.id]??0} play{(playCounts[track.id]??0)===1?'':'s'}</span><em>{track.duration}</em></div>)}</div></div>;
}

function ArtistDetail({name,tracks,playCounts,onBack,onPlay,onAlbum,onContext}:{name:string;tracks:Track[];playCounts:PlayCounts;onBack:()=>void;onPlay:(track:Track,context?:Track[])=>void;onAlbum:(name:string)=>void;onContext:(e:React.MouseEvent,track:Track)=>void}) {
  const artistTracks=tracks.filter(t=>t.artist===name); if(!artistTracks.length)return null;
  const albums=uniqueAlbums(artistTracks);
  const top=[...artistTracks].sort((a,b)=>(playCounts[b.id]??0)-(playCounts[a.id]??0)).slice(0,5);
  const totalPlays=artistTracks.reduce((n,t)=>n+(playCounts[t.id]??0),0);
  const lead=artistTracks[0];
  return <div className="detail-page artist-detail"><button className="detail-back" onClick={onBack}><Icon name="back"/> Back to artists</button><div className="artist-hero"><div className="artist-avatar"><AlbumArt track={lead} size="large"/></div><div><span className="eyebrow">ARTIST</span><h1>{name}</h1><p>{artistTracks.length} songs · {albums.length} albums · {totalPlays} plays in Reson</p><div className="detail-actions"><button className="hero-play" onClick={()=>onPlay(artistTracks[0],artistTracks)}><Icon name="play"/> Play</button><button onClick={()=>{const q=shuffleArray(artistTracks);onPlay(q[0],q)}}><Icon name="shuffle"/> Shuffle artist</button></div></div></div><section className="detail-section"><div className="section-title"><h2>Popular in your library</h2><span>Based on your plays</span></div><div className="artist-popular">{top.map((track,i)=><div className="artist-song" key={track.id} onContextMenu={(e)=>onContext(e,track)} onClick={()=>onPlay(track,artistTracks)}><span>{i+1}</span><AlbumArt track={track} size="activity"/><div><strong>{track.title}</strong><small>{track.album}</small></div><em>{playCounts[track.id]??0} plays</em><b>{track.duration}</b></div>)}</div></section><section className="detail-section"><div className="section-title"><h2>Albums in your library</h2><span>{albums.length} releases</span></div><div className="library-grid">{albums.map(album=><button className="album-card library-card" key={album.album} onClick={()=>onAlbum(album.album)}><div className="art-shell"><AlbumArt track={album} size="large"/></div><strong>{album.album}</strong><span>{artistTracks.filter(t=>t.album===album.album).length} songs</span></button>)}</div></section></div>;
}

function SelectionToolbar({selectedIds,tracks,likedIds,playlists,onClear,onLike,onQueue,onPlaylist}:{selectedIds:string[];tracks:Track[];likedIds:string[];playlists:Playlist[];onClear:()=>void;onLike:()=>void;onQueue:()=>void;onPlaylist:(id:string)=>void}) {
  if(!selectedIds.length) return null;
  const allLiked=selectedIds.every(id=>likedIds.includes(id));
  return <div className="selection-toolbar"><strong>{selectedIds.length} selected</strong><span>{formatLongDuration(tracks.filter(t=>selectedIds.includes(t.id)).reduce((n,t)=>n+t.durationSeconds,0))}</span><button onClick={onLike}><Icon name="heart"/>{allLiked?'Unlike':'Like'}</button><button onClick={onQueue}><Icon name="queue"/>Queue</button>{playlists.length>0&&<label><Icon name="playlist"/><select defaultValue="" onChange={e=>{if(e.target.value){onPlaylist(e.target.value);e.currentTarget.value='';}}}><option value="" disabled>Add to playlist…</option>{playlists.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}<button className="selection-clear" onClick={onClear}>Clear</button></div>;
}

function TrackTable({tracks,onPlay,likedIds,onContext,selectedIds=[],onSelection}:{tracks:Track[];onPlay:(track:Track,context?:Track[])=>void;likedIds:string[];onContext?:(e:React.MouseEvent,track:Track)=>void;selectedIds?:string[];onSelection?:(ids:string[])=>void}) {
  const PAGE_SIZE=250;
  const [renderLimit,setRenderLimit]=useState(PAGE_SIZE);
  const lastSelected=useRef<number|null>(null);

  useEffect(()=>{
    setRenderLimit(PAGE_SIZE);
    lastSelected.current=null;
  },[tracks]);

  const visibleRows=tracks.slice(0,renderLimit);
  const remaining=Math.max(0,tracks.length-visibleRows.length);

  const select=(event:React.MouseEvent,track:Track,index:number)=>{
    if(!onSelection){onPlay(track,tracks);return;}
    event.preventDefault();
    if(event.shiftKey&&lastSelected.current!==null){
      const a=Math.min(lastSelected.current,index),b=Math.max(lastSelected.current,index);
      const range=tracks.slice(a,b+1).map(t=>t.id);
      onSelection(Array.from(new Set([...selectedIds,...range])));
    }else if(event.ctrlKey||event.metaKey){
      onSelection(selectedIds.includes(track.id)?selectedIds.filter(id=>id!==track.id):[...selectedIds,track.id]);
      lastSelected.current=index;
    }else{
      onSelection(selectedIds.length===1&&selectedIds[0]===track.id?[]:[track.id]);
      lastSelected.current=index;
    }
  };

  return <div className="track-table">
    <div className="track-row track-header"><span>#</span><span>TITLE</span><span>ALBUM</span><span><Icon name="clock"/></span></div>
    {visibleRows.map((track,index)=><button className={`track-row ${selectedIds.includes(track.id)?'selected':''}`} key={track.id} onContextMenu={(e)=>onContext?.(e,track)} onDoubleClick={()=>onPlay(track,tracks)} onClick={(e)=>select(e,track,index)}><span className="track-number">{selectedIds.includes(track.id)?'✓':index+1}</span><span className="track-main"><AlbumArt track={track} size="activity"/><span><strong>{track.title}{likedIds.includes(track.id)&&<b className="mini-heart">♥</b>}</strong><small>{track.artist}</small></span></span><span>{track.album}</span><span>{track.duration}</span></button>)}
    {remaining>0&&<div className="large-list-more"><span>Showing {visibleRows.length.toLocaleString()} of {tracks.length.toLocaleString()} songs</span><button onClick={()=>setRenderLimit(limit=>Math.min(tracks.length,limit+PAGE_SIZE))}>Load {Math.min(PAGE_SIZE,remaining)} more</button></div>}
  </div>;
}


function PlaylistsPage({playlists,activePlaylistId,tracks,onSelect,onBack,onCreate,onDelete,onRename,onCover,onClearCover,onMoveTrack,onAddTrack,onRemoveTrack,onPlay,onPlayPlaylist,playingPlaylistId,onContext}:{playlists:Playlist[];activePlaylistId:string|null;tracks:Track[];onSelect:(id:string)=>void;onBack:()=>void;onCreate:()=>void;onDelete:(id:string)=>void;onRename:(id:string)=>void;onCover:(id:string)=>void;onClearCover:(id:string)=>void;onMoveTrack:(playlistId:string,index:number,direction:-1|1)=>void;onAddTrack:(playlistId:string,trackId:string)=>void;onRemoveTrack:(playlistId:string,trackId:string)=>void;onPlay:(track:Track,context?:Track[],playlistId?:string|null)=>void;onPlayPlaylist:(playlist:Playlist,shuffled?:boolean)=>void;playingPlaylistId:string|null;onContext:(e:React.MouseEvent,track:Track)=>void}) {
  const PLAYLIST_PAGE_SIZE=200;
  const [playlistRenderLimit,setPlaylistRenderLimit]=useState(PLAYLIST_PAGE_SIZE);
  useEffect(()=>setPlaylistRenderLimit(PLAYLIST_PAGE_SIZE),[activePlaylistId]);

  const activePlaylist=playlists.find(p=>p.id===activePlaylistId) ?? null;
  if(activePlaylist){
    const playlistTracks=activePlaylist.trackIds.map(id=>tracks.find(t=>t.id===id)).filter((t):t is Track=>!!t);
    const available=tracks.filter(t=>!activePlaylist.trackIds.includes(t.id));
    return <div className="library-page playlist-page"><button className="playlist-back-button" onClick={onBack}><Icon name="back"/>All Playlists</button><div className="playlist-detail-head"><button className="playlist-cover" title="Change playlist cover" onClick={()=>void onCover(activePlaylist.id)}>{activePlaylist.coverPath?<img className="playlist-custom-cover" src={resonImageSrc(activePlaylist.coverPath)} alt=""/>:<Icon name="playlist"/>}</button><div><span className="eyebrow">PLAYLIST</span><h1>{activePlaylist.name}</h1><p>{playlistTracks.length} song{playlistTracks.length===1?'':'s'}{playingPlaylistId===activePlaylist.id?' · Playing from this playlist':''}</p></div><div className="playlist-head-actions"><button className="playlist-play-all" onClick={()=>onPlayPlaylist(activePlaylist,false)}><Icon name="play"/>Play</button><button className="playlist-shuffle-all" onClick={()=>onPlayPlaylist(activePlaylist,true)}><Icon name="shuffle"/>Shuffle</button><button onClick={()=>void onCover(activePlaylist.id)}>Cover</button>{activePlaylist.coverPath&&<button onClick={()=>onClearCover(activePlaylist.id)}>Reset cover</button>}<button onClick={()=>onRename(activePlaylist.id)}>Rename</button><button onClick={()=>{if(window.confirm(`Delete ${activePlaylist.name}?`))onDelete(activePlaylist.id)}}>Delete</button></div></div>{playlistTracks.length?<div className="playlist-track-list">{playlistTracks.slice(0,playlistRenderLimit).map((track,index)=><div className="playlist-track" key={track.id} onContextMenu={(e)=>onContext(e,track)}><button className="playlist-play" onClick={()=>onPlay(track,playlistTracks,activePlaylist.id)}><span>{index+1}</span><AlbumArt track={track} size="activity"/><div><strong>{track.title}</strong><small>{track.artist} · {track.album}</small></div><em>{track.duration}</em></button><div className="playlist-row-actions"><button disabled={index===0} onClick={()=>onMoveTrack(activePlaylist.id,index,-1)}>↑</button><button disabled={index===playlistTracks.length-1} onClick={()=>onMoveTrack(activePlaylist.id,index,1)}>↓</button><button className="playlist-remove" onClick={()=>onRemoveTrack(activePlaylist.id,track.id)}>×</button></div></div>)}{playlistTracks.length>playlistRenderLimit&&<div className="large-list-more playlist-list-more"><span>Showing {playlistRenderLimit.toLocaleString()} of {playlistTracks.length.toLocaleString()} songs</span><button onClick={()=>setPlaylistRenderLimit(limit=>Math.min(playlistTracks.length,limit+PLAYLIST_PAGE_SIZE))}>Load {Math.min(PLAYLIST_PAGE_SIZE,playlistTracks.length-playlistRenderLimit)} more</button></div>}</div>:<div className="playlist-empty"><Icon name="song"/><h2>This playlist is empty</h2><p>Add something from your library below.</p></div>}<div className="playlist-add-section"><div className="section-title"><h2>Add from your library</h2><span>{available.length} available</span></div><div className="playlist-add-list">{available.slice(0,30).map(track=><div key={track.id} onContextMenu={(e)=>onContext(e,track)}><AlbumArt track={track} size="activity"/><span><strong>{track.title}</strong><small>{track.artist}</small></span><button onClick={()=>onAddTrack(activePlaylist.id,track.id)}><Icon name="plus"/> Add</button></div>)}</div></div></div>;
  }
  return <div className="library-page playlist-page"><div className="page-heading library-heading-row"><div><p>YOUR COLLECTION</p><h1>Playlists</h1><span>Build collections for any mood, album run, or moment.</span></div><button className="rescan-button" onClick={onCreate}><Icon name="plus"/>New playlist</button></div>{playlists.length?<div className="playlist-grid">{playlists.map((playlist,index)=>{const first=playlist.trackIds.map(id=>tracks.find(t=>t.id===id)).find(Boolean);return <button key={playlist.id} onClick={()=>onSelect(playlist.id)}><div className="playlist-cover">{playlist.coverPath?<img className="playlist-custom-cover" src={resonImageSrc(playlist.coverPath)} alt=""/>:first?<AlbumArt track={first} size="large"/>:<><Icon name="playlist"/><b>{index+1}</b></>}</div><strong>{playlist.name}</strong><span>{playlist.trackIds.length} songs</span></button>})}<button className="playlist-new-card" onClick={onCreate}><div className="playlist-cover"><Icon name="plus"/></div><strong>New playlist</strong><span>Start a collection</span></button></div>:<div className="empty-library"><div className="feature-icon"><Icon name="playlist"/></div><h2>Your playlists will live here</h2><p>Create a playlist, then add any songs already indexed in your Reson library.</p><button onClick={onCreate}><Icon name="plus"/> Create playlist</button></div>}</div>;
}


function DiscoverPage({tracks,playCounts,onMusicHelper}:{tracks:Track[];playCounts:PlayCounts;onMusicHelper:()=>void}) {
  const [inspired, setInspired] = useState<DiscoverAlbum[]>([]);
  const [results, setResults] = useState<DiscoverAlbum[]>([]);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<DiscoverMode>(() => (localStorage.getItem('reson.discoverMode') as DiscoverMode) || 'forYou');
  const [saved, setSaved] = useState<DiscoverAlbum[]>(() => {
    try { return JSON.parse(localStorage.getItem('reson.discoverSaved') ?? '[]'); } catch { return []; }
  });

  useEffect(()=>localStorage.setItem('reson.discoverSaved',JSON.stringify(saved)),[saved]);
  useEffect(()=>localStorage.setItem('reson.discoverMode',mode),[mode]);

  const seedArtist = useMemo(() => {
    const scored = new Map<string, number>();
    for (const track of tracks) scored.set(track.artist, (scored.get(track.artist) ?? 0) + (playCounts[track.id] ?? 0) + 1);
    return [...scored.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0] || 'alternative';
  }, [tracks, playCounts]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true); setMessage('');
      try {
        const artistData = await invoke<DiscoverAlbum[]>('discover_search', { term: seedArtist, limit: 18 });
        if(!cancelled) setInspired(artistData);
      } catch (error) {
        if(!cancelled) setMessage(`Discover couldn't reach the catalog: ${String(error)}`);
      } finally { if(!cancelled) setLoading(false); }
    };
    void load();
    return () => { cancelled = true; };
  }, [seedArtist]);

  const searchCatalog = async () => {
    const q = catalogQuery.trim(); if(!q) return;
    setLoading(true); setMessage('');
    try { setResults(await invoke<DiscoverAlbum[]>('discover_search', { term: q, limit: 18 })); }
    catch(error){ setMessage(`Search failed: ${String(error)}`); }
    finally { setLoading(false); }
  };

  const normalize=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const owned = (album:DiscoverAlbum) => tracks.some(track => normalize(track.album) === normalize(album.title) && normalize(track.artist) === normalize(album.artist));
  const savedAlready=(album:DiscoverAlbum)=>saved.some(item=>item.id===album.id);
  const toggleSaved=(album:DiscoverAlbum)=>setSaved(items=>items.some(item=>item.id===album.id)?items.filter(item=>item.id!==album.id):[album,...items]);
  const acquired=saved.filter(owned);
  const wanted=saved.filter(album=>!owned(album));
  const copySearch=async(album:DiscoverAlbum)=>{
    const text=`${album.artist} - ${album.title}`;
    try{await navigator.clipboard.writeText(text);setMessage(`Copied “${text}” to your clipboard.`)}
    catch{setMessage(`Search for: ${text}`)}
  };
  const openRelease=async(album:DiscoverAlbum)=>{
    if(!album.storeUrl){setMessage('No catalog page is available for this release.');return;}
    try{await openUrl(album.storeUrl)}catch(error){setMessage(`Could not open the catalog page: ${String(error)}`)}
  };

  const card=(album:DiscoverAlbum,reason?:string)=><article className={`discover-card ${owned(album)?'is-owned':''}`} key={album.id}>
    <div className="discover-art">{album.artworkUrl?<img src={album.artworkUrl} alt=""/>:<Icon name="album"/>}{owned(album)&&<span className="owned-badge">IN YOUR LIBRARY</span>}{savedAlready(album)&&!owned(album)&&<span className="saved-badge">SAVED</span>}</div>
    <strong title={album.title}>{album.title}</strong><span title={album.artist}>{album.artist}</span>
    <small>{album.releaseDate ? new Date(album.releaseDate).getFullYear() : 'Catalog release'}</small>
    {reason&&<p className="discover-reason">{reason}</p>}
    <div className="discover-actions">
      {!owned(album)&&<button className={savedAlready(album)?'saved':''} onClick={()=>toggleSaved(album)}><Icon name={savedAlready(album)?'heart':'plus'}/>{savedAlready(album)?'Saved':'Save'}</button>}
      <button onClick={()=>void copySearch(album)}><Icon name="search"/>Copy search</button>
      <button onClick={()=>void openRelease(album)}><Icon name="external"/>Catalog</button>
      {!owned(album)&&<button onClick={onMusicHelper}><Icon name="external"/>Helper</button>}
      {owned(album)&&<span className="discover-owned-action">✓ Added</span>}
    </div>
  </article>;

  const grid=(albums:DiscoverAlbum[],reason?:string)=>albums.length?<div className="discover-grid">{albums.map(album=>card(album,reason))}</div>:<div className="discover-empty-state"><Icon name="discover"/><strong>Nothing here yet</strong><span>This section will fill in as you use Discover.</span></div>;

  return <div className="discover-page">
    <div className="discover-hero"><div><p>MUSIC DISCOVERY</p><h1>Discover</h1><span>Find something interesting, save it, use your preferred source to get a local copy, then let Reson recognize it after your next scan.</span></div><div className="discover-search"><Icon name="search"/><input value={catalogQuery} onChange={e=>setCatalogQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void searchCatalog()}} placeholder="Search artists or albums..."/><button onClick={()=>void searchCatalog()}>Search</button></div></div>

    <div className="discover-mode-tabs">
      <button className={mode==='forYou'?'active':''} onClick={()=>setMode('forYou')}>For You</button>
      <button className={mode==='saved'?'active':''} onClick={()=>setMode('saved')}>Saved <span>{wanted.length}</span></button>
      <button className={mode==='added'?'active':''} onClick={()=>setMode('added')}>Added <span>{acquired.length}</span></button>
    </div>

    {message&&<div className="discover-message">{message}</div>}
    {loading&&<div className="discover-loading"><i/><span>Loading catalog…</span></div>}

    {mode==='forYou'&&<>
      {results.length>0&&<section className="discover-section"><div className="discover-section-head"><div><h2>Search Results</h2><span>{results.length} matches for “{catalogQuery}”.</span></div></div>{grid(results)}</section>}
      <section className="discover-section"><div className="discover-section-head"><div><h2>Inspired by {seedArtist}</h2><span>Reson picked this artist because they rank highly in your local listening history.</span></div></div>{grid(inspired,`Because you listen to ${seedArtist}`)}</section>
      {!tracks.length&&!loading&&<div className="discover-note"><Icon name="library"/><div><strong>Discover gets smarter with your library</strong><span>Add your music folder and Reson will use the artists you already listen to as discovery seeds.</span></div></div>}
    </>}

    {mode==='saved'&&<>
      <section className="discover-workflow-card"><div><span className="eyebrow">HOW IT WORKS</span><h2>Your Want List</h2><p>Save something here, copy the exact search phrase or open your Music Helper, add the local files to your music folder, then rescan Reson. Matching releases move to Added automatically.</p></div><button onClick={onMusicHelper}><Icon name="external"/>Open Music Helper</button></section>
      {wanted.length? <div className="discover-want-list expanded">{wanted.map(album=><div key={`want-${album.id}`}><img src={album.artworkUrl} alt=""/><span><strong>{album.title}</strong><small>{album.artist}</small></span><button onClick={()=>void copySearch(album)}>Copy search</button><button onClick={()=>void openRelease(album)}>Catalog</button><button onClick={onMusicHelper}>Helper</button><button onClick={()=>toggleSaved(album)}>Remove</button></div>)}</div>:<div className="discover-empty-state large"><Icon name="heart"/><strong>Nothing saved yet</strong><span>Use For You or Search to build a list of music you want to add later.</span></div>}
    </>}

    {mode==='added'&&<>
      <section className="discover-section"><div className="discover-section-head"><div><h2>Added from Discover</h2><span>Saved releases Reson now detects in your local library.</span></div></div>{grid(acquired)}</section>
      {!acquired.length&&<div className="discover-empty-state large"><Icon name="library"/><strong>No matches yet</strong><span>When a saved release appears in your local library after a rescan, it will show up here.</span></div>}
    </>}

    <p className="catalog-credit">Catalog metadata and artwork provided by the iTunes Search API. Reson does not stream or download these releases.</p>
  </div>;
}


function FriendsPage({serverUrl,setServerUrl,token,user,friends,requests,leaderboard,metric,status,message,onLogin,onLogout,onRefresh,onRequest,onRespond,onMetric,cloudBackupUpdatedAt,cloudSyncBusy,onBackup,onRestore}:{serverUrl:string;setServerUrl:(v:string)=>void;token:string;user:SocialUser|null;friends:SocialUser[];requests:FriendRequest[];leaderboard:LeaderboardEntry[];metric:'total'|'weekly'|'songs';status:'idle'|'connecting'|'online'|'offline';message:string;onLogin:(u:string,p:string,r:boolean)=>Promise<void>;onLogout:()=>void;onRefresh:()=>void;onRequest:(u:string)=>Promise<void>;onRespond:(id:number,a:boolean)=>Promise<void>;onMetric:(m:'total'|'weekly'|'songs')=>void;cloudBackupUpdatedAt:number|null;cloudSyncBusy:boolean;onBackup:()=>void;onRestore:()=>void}) {
  const [username,setUsername]=useState('');
  const [password,setPassword]=useState('');
  const [register,setRegister]=useState(false);
  const [friendName,setFriendName]=useState('');

  if(!token){
    return <div className="friends-page page-enter">
      <div className="page-heading"><p>RESON SOCIAL</p><h1>Friends</h1><span>Connect to your Reson Server without changing how local playback works.</span></div>
      <section className="social-login-card">
        <div className="social-server-row"><div><strong>Server</strong><small>Your server laptop's address, including port 4782.</small></div><input value={serverUrl} onChange={e=>setServerUrl(e.target.value)} placeholder="http://192.168.1.50:4782"/></div>
        <div className="social-auth-grid"><label><span>Username</span><input value={username} onChange={e=>setUsername(e.target.value.toLowerCase())} placeholder="username"/></label><label><span>Password</span><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="8+ characters"/></label></div>
        <div className="social-auth-actions"><button className="primary" disabled={!username||password.length<8||status==='connecting'} onClick={()=>void onLogin(username,password,register)}>{status==='connecting'?'Connecting…':register?'Create account':'Sign in'}</button><button onClick={()=>setRegister(v=>!v)}>{register?'I already have an account':'Create an account'}</button></div>
        {message&&<p className="social-message">{message}</p>}
      </section>
    </div>;
  }

  return <div className="friends-page page-enter">
    <div className="page-heading social-heading"><div><p>RESON SOCIAL</p><h1>Friends</h1><span>{status==='online'?'Connected to Reson Server':'Local Reson still works while the server is unavailable.'}</span></div><div className={`social-status ${status}`}><i/>{status}</div></div>
    <section className="social-me-card"><div><span className="social-avatar">{user?.avatarUrl?<img src={user.avatarUrl} alt=""/>:(user?.displayName||user?.username||'R').slice(0,1).toUpperCase()}</span><div><strong>{user?.displayName||'Reson user'}</strong><small>@{user?.username||'—'}</small></div></div><div className="social-me-actions"><button onClick={onRefresh}>Refresh</button><button onClick={onLogout}>Sign out</button></div></section>
    {message&&<p className="social-message">{message}</p>}

    <section className="social-card account-sync-card">
      <div className="section-title"><div><h2>Account Sync</h2><p>Back up Reson metadata and profile customization. Your MP3 files never leave this device.</p></div><span>{cloudBackupUpdatedAt?`Cloud backup · ${new Date(cloudBackupUpdatedAt).toLocaleString()}`:'No cloud backup yet'}</span></div>
      <div className="account-sync-actions">
        <button disabled={cloudSyncBusy} onClick={()=>{if(window.confirm('Use this device as the account backup? This replaces the current cloud backup with the data on this PC.'))onBackup();}}><Icon name="folder"/>Back up this device</button>
        <button disabled={cloudSyncBusy||!cloudBackupUpdatedAt} onClick={()=>{if(window.confirm('Restore the cloud backup onto this device? Local Reson profile, playlists, likes and stats will be replaced by the account backup.'))onRestore();}}><Icon name="refresh"/>Restore from cloud</button>
      </div>
      <small className="account-sync-note">Playlists, likes, play counts and history reconnect to matching local songs by title, artist, album and duration. Profile avatar/banner/background images are included when small enough.</small>
    </section>

    <section className="social-card social-add-friend-card">
      <div className="section-title"><div><h2>Add a friend</h2><p>Friend profiles and stats stay private to accepted friends.</p></div></div>
      <div className="social-friend-add"><input value={friendName} onChange={e=>setFriendName(e.target.value.toLowerCase())} placeholder="username"/><button disabled={!friendName} onClick={()=>{void onRequest(friendName);setFriendName('')}}>Send request</button></div>
      {requests.length>0&&<><h3 className="social-subhead">Incoming requests</h3><div className="friend-request-list">{requests.map(r=><div key={r.id}><span className="social-avatar small">{r.displayName.slice(0,1).toUpperCase()}</span><div><strong>{r.displayName}</strong><small>@{r.username}</small></div><button onClick={()=>void onRespond(r.id,true)}>Accept</button><button className="muted" onClick={()=>void onRespond(r.id,false)}>Decline</button></div>)}</div></>}
    </section>

    <section className="social-card leaderboard-card-large">
      <div className="section-title leaderboard-title-row">
        <div><h2>Friends Leaderboard</h2><p>See how your listening stacks up against your accepted friends.</p></div>
        <div className="leaderboard-tabs"><button className={metric==='total'?'active':''} onClick={()=>onMetric('total')}>All time</button><button className={metric==='weekly'?'active':''} onClick={()=>onMetric('weekly')}>This week</button><button className={metric==='songs'?'active':''} onClick={()=>onMetric('songs')}>Songs</button></div>
      </div>
      {leaderboard.length?<div className="leaderboard-list-large">{leaderboard.map(entry=>{
        const value=metric==='songs'?`${entry.user.songsInLibrary.toLocaleString()} songs`:formatListenTime(metric==='weekly'?entry.user.weeklyListenSeconds:entry.user.totalListenSeconds);
        return <div className={`leaderboard-row-large rank-${entry.rank}`} key={entry.user.id}>
          <div className="leaderboard-rank"><b>{entry.rank}</b><small>{entry.rank===1?'1ST':entry.rank===2?'2ND':entry.rank===3?'3RD':'RANK'}</small></div>
          <span className="social-avatar leaderboard-avatar">{entry.user.avatarUrl?<img src={entry.user.avatarUrl} alt=""/>:entry.user.displayName.slice(0,1).toUpperCase()}</span>
          <div className="leaderboard-person"><strong>{entry.user.displayName}</strong><span>@{entry.user.username}</span>{entry.user.isPlaying?<small><i/>Listening to {entry.user.trackTitle} · {entry.user.trackArtist}</small>:<small className="quiet">{entry.user.status==='online'?'Online':'Offline'}{entry.user.topArtist?` · Top artist: ${entry.user.topArtist}`:''}</small>}</div>
          <div className="leaderboard-score"><strong>{value}</strong><small>{metric==='songs'?'LIBRARY':metric==='weekly'?'LISTENED THIS WEEK':'TOTAL LISTENING'}</small></div>
        </div>;
      })}</div>:<div className="profile-empty-card compact"><Icon name="stats"/><div><strong>No leaderboard data yet</strong><span>Add a friend and sync your account stats to start comparing.</span></div></div>}
    </section>

    <section className="social-card">
      <div className="section-title"><div><h2>Your friends</h2><p>Presence and currently-listening status from Reson Server.</p></div><span>{friends.length}</span></div>
      {friends.length?<div className="friends-grid">{friends.map(friend=><div key={friend.id} className="friend-card"><div className="friend-head"><span className="social-avatar">{friend.avatarUrl?<img src={friend.avatarUrl} alt=""/>:friend.displayName.slice(0,1).toUpperCase()}</span><div><strong>{friend.displayName}</strong><small>@{friend.username}</small></div><i className={friend.status||'offline'}/></div><div className="friend-presence"><small>{friend.isPlaying?'LISTENING NOW':friend.status==='online'?'ONLINE':'OFFLINE'}</small><strong>{friend.isPlaying?friend.trackTitle:(friend.topArtist||'No listening data')}</strong><span>{friend.isPlaying?friend.trackArtist:`${friend.songsInLibrary} songs · ${formatListenTime(friend.totalListenSeconds)}`}</span></div></div>)}</div>:<div className="profile-empty-card compact"><Icon name="artist"/><div><strong>No friends yet</strong><span>Send someone a request using their Reson username.</span></div></div>}
    </section>
  </div>;
}

function StatsPage({tracks,playCounts,history,totalListenSeconds,dailyListenSeconds,weeklyRecaps,onPlay,onContext}:{tracks:Track[];playCounts:PlayCounts;history:HistoryEntry[];totalListenSeconds:number;dailyListenSeconds:DailyListenSeconds;weeklyRecaps:WeeklyRecap[];onPlay:(track:Track)=>void;onContext:(e:React.MouseEvent,track:Track)=>void}) {
  const summary=useMemo(()=>{
    let totalPlays=0;
    const ranked:Track[]=[];
    const artists=new Set<string>();
    for(const track of tracks){
      artists.add(track.artist);
      const plays=playCounts[track.id]??0;
      totalPlays+=plays;
      if(plays>0)ranked.push(track);
    }
    ranked.sort((a,b)=>(playCounts[b.id]??0)-(playCounts[a.id]??0));
    return {totalPlays,top:ranked.slice(0,5),artistCount:artists.size,songsPlayed:new Set(history.map(h=>h.trackId)).size};
  },[tracks,playCounts,history]);
  const {totalPlays,top}=summary;
  const days=useMemo(()=>currentWeekListening(dailyListenSeconds),[dailyListenSeconds]);
  const weekSeconds=useMemo(()=>days.reduce((sum,day)=>sum+day.seconds,0),[days]);
  const maxDay=useMemo(()=>Math.max(1,...days.map(day=>day.seconds)),[days]);
  const latestRecap=weeklyRecaps[0] ?? null;

  return <div className="stats-page">
    <div className="page-heading"><p>YOUR LISTENING</p><h1>Stats</h1><span>Reson keeps your play counts, recent history, and listening time on this device. Daily and weekly listening-time tracking begins with v0.18.</span></div>
    <div className="stat-grid"><Stat value={formatListenTime(totalListenSeconds)} label="Listening time"/><Stat value={formatListenTime(weekSeconds)} label="This week"/><Stat value={String(totalPlays)} label="Total plays"/><Stat value={String(summary.songsPlayed)} label="Songs played"/><Stat value={String(summary.artistCount)} label="Artists"/></div>

    <div className="chart-card weekly-listen-card">
      <div className="section-line"><strong>Listening this week</strong><span>{formatListenTime(weekSeconds)} · Monday–Sunday</span></div>
      <div className="bars listening-bars">{days.map(day=><div className="bar-column" key={day.key} title={`${day.fullLabel}: ${formatListenTime(day.seconds)}`}><b>{day.seconds>=60?formatCompactListen(day.seconds):''}</b><i style={{height:`${Math.max(4,(day.seconds/maxDay)*100)}%`}}/><span>{day.label}</span></div>)}</div>
      <div className="weekly-chart-note">Actual playback time · hover a day for its exact total</div>
    </div>

    {latestRecap&&<div className="weekly-recap-feature">
      <div className="weekly-recap-heading"><div><span className="eyebrow">COMPLETED WEEK</span><h2>Your latest recap</h2><p>{formatWeekRange(latestRecap.weekStart,latestRecap.weekEnd)}</p></div><strong>{formatListenTime(latestRecap.totalSeconds)}</strong></div>
      <div className="weekly-recap-grid">
        <span><small>Unique tracks</small><b>{latestRecap.uniqueTracks}</b></span>
        <span><small>Song starts</small><b>{latestRecap.songStarts}</b></span>
        <span><small>Top artist</small><b>{latestRecap.topArtist||'—'}</b></span>
        <span><small>Top album</small><b>{latestRecap.topAlbum||'—'}</b></span>
        <span><small>Biggest day</small><b>{latestRecap.bestDay?`${new Date(`${latestRecap.bestDay}T12:00:00`).toLocaleDateString(undefined,{weekday:'long'})} · ${formatListenTime(latestRecap.bestDaySeconds)}`:'—'}</b></span>
      </div>
      {latestRecap.topTrackId&&tracks.find(t=>t.id===latestRecap.topTrackId)&&(()=>{const track=tracks.find(t=>t.id===latestRecap.topTrackId)!;return <button className="recap-top-track" onClick={()=>onPlay(track)} onContextMenu={(e)=>onContext(e,track)}><AlbumArt track={track} size="activity"/><span><small>MOST STARTED TRACK</small><strong>{track.title}</strong><em>{track.artist}</em></span><Icon name="play"/></button>})()}
    </div>}

    {weeklyRecaps.length>0&&<div className="recap-history-card"><div className="section-line"><strong>Weekly Recaps</strong><span>{weeklyRecaps.length} completed week{weeklyRecaps.length===1?'':'s'}</span></div><div className="recap-history-grid">{weeklyRecaps.slice(0,12).map(recap=><article key={recap.id}><span>{formatWeekRange(recap.weekStart,recap.weekEnd)}</span><strong>{formatListenTime(recap.totalSeconds)}</strong><small>{recap.uniqueTracks} unique tracks · {recap.topArtist||'No top artist yet'}</small></article>)}</div></div>}

    {top.length>0&&<div className="top-tracks-card"><div className="section-line"><strong>Most played</strong><span>All time on this device</span></div>{top.map((track,index)=><div className="top-track-row" role="button" tabIndex={0} key={track.id} onClick={()=>onPlay(track)} onContextMenu={(e)=>onContext(e,track)} onKeyDown={(event)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onPlay(track)}}}><b>{index+1}</b><AlbumArt track={track} size="activity"/><span><strong>{track.title}</strong><small>{track.artist}</small></span><em>{playCounts[track.id]} plays</em></div>)}</div>}
  </div>;
}

function FeaturePage({icon,title,text}:{icon:IconName;title:string;text:string}) { return <div className="feature-page"><div className="feature-icon"><Icon name={icon}/></div><h1>{title}</h1><p>{text}</p><button>Planned for a later v0.2 build</button></div>; }
function Stat({value,label}:{value:string;label:string}) { return <div className="stat-card"><strong>{value}</strong><span>{label}</span></div>; }
function SectionTitle({title,onSeeAll}:{title:string;onSeeAll?:()=>void}) { return <div className="section-title"><h2>{title}</h2>{onSeeAll&&<button onClick={onSeeAll}>See all</button>}</div>; }
function SidebarHeading({label,onAdd}:{label:string;onAdd?:()=>void}) { return <div className="sidebar-heading"><span>{label}</span>{onAdd&&<button onClick={onAdd}><Icon name="plus"/></button>}</div>; }


function WaveformSeek({track,progress,onSeek,compact=false}:{track:Track;progress:number;onSeek:(value:number)=>void;compact?:boolean}) {
  const values=track.waveform ?? [];
  const playedIndex=values.length ? Math.floor((Math.max(0,Math.min(100,progress))/100)*values.length) : 0;
  return <div className={`real-waveform-seek ${compact?'compact':''} ${values.length?'ready':'loading'}`}>
    {values.length
      ? <div className="real-waveform" aria-hidden="true">{values.map((value,index)=><i key={index} className={index<=playedIndex?'played':''} style={{height:`${Math.max(8,value*100)}%`}}/>)}</div>
      : <div className="waveform-placeholder" aria-hidden="true"><i style={{width:`${progress}%`}}/></div>}
    <input aria-label="Seek through track" type="range" min="0" max="100" step=".1" value={progress} onChange={e=>onSeek(Number(e.target.value))} style={{'--range-progress':`${progress}%`} as CSSProperties}/>
  </div>;
}

function AlbumArt({track,size}:{track:Track;size:'large'|'player'|'activity'}) { const initials=(track.album||track.title).split(' ').filter(Boolean).map(p=>p[0]).join('').slice(0,2).toUpperCase(); if(track.artworkPath){return <div className={`album-art real-art ${size}`}><img src={convertFileSrc(track.artworkPath)} alt={`${track.album} cover`} loading={size==='player'?'eager':'lazy'} decoding="async" /></div>} return <div className={`album-art tone-art-${track.tone} ${size}`}><span className="album-pattern"/><b>{initials||'R'}</b><small>{track.album}</small></div>; }

function Icon({name}:{name:IconName}) {
  const paths: Record<IconName,ReactNode> = {
    home:<><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-5h5v5"/></>, library:<><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></>, playlist:<><path d="M4 6h10M4 11h10M4 16h6"/><path d="M16 14v6M16 14l5-1v6"/><circle cx="14.5" cy="20" r="1.5"/><circle cx="19.5" cy="19" r="1.5"/></>, discover:<><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/></>, stats:<><path d="M5 20V10M10 20V5M15 20v-8M20 20V7"/></>, heart:<path d="M20.8 5.7c-2-2-5.2-2-7.2 0L12 7.3l-1.6-1.6c-2-2-5.2-2-7.2 0s-2 5.2 0 7.2L12 21l8.8-8.1c2-2 2-5.2 0-7.2Z"/>, album:<><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/></>, artist:<><circle cx="12" cy="8" r="4"/><path d="M4.5 21c.8-4.2 3.2-6.5 7.5-6.5s6.7 2.3 7.5 6.5"/></>, song:<><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></>, tag:<path d="M20 13 13 20 4 11V4h7l9 9Z"/>, search:<><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>, bell:<><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>, chevronDown:<path d="m8 10 4 4 4-4"/>, back:<path d="m15 18-6-6 6-6"/>, forward:<path d="m9 18 6-6-6-6"/>, plus:<path d="M12 5v14M5 12h14"/>, shuffle:<><path d="M3 7h3c5 0 6 10 11 10h4"/><path d="m18 14 3 3-3 3"/><path d="M3 17h3c2.3 0 3.7-2 5-4"/><path d="M14 8c1-1 2-1 3-1h4"/><path d="m18 4 3 3-3 3"/></>, previous:<><path d="M6 5v14"/><path d="m18 6-9 6 9 6V6Z"/></>, play:<path d="m8 5 11 7-11 7V5Z"/>, pause:<><path d="M9 6v12M15 6v12"/></>, next:<><path d="M18 5v14"/><path d="m6 6 9 6-9 6V6Z"/></>, repeat:<><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></>, volume:<><path d="M5 9v6h4l5 4V5L9 9H5Z"/><path d="M17 9c1.4 1.6 1.4 4.4 0 6M19.5 6.5c3 3 3 8 0 11"/></>, queue:<><path d="M4 6h12M4 11h12M4 16h8"/><path d="m17 15 4 3-4 3v-6Z"/></>, device:<><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M9 21h6M12 17v4"/></>, expand:<><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></>, activity:<path d="M3 12h4l2-7 4 14 2-7h6"/>, clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>, folder:<><path d="M3 7h7l2 2h9v10H3V7Z"/><path d="M3 7V5h7l2 2"/></>, refresh:<><path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18 10a7 7 0 0 0-12-2L4 11M6 14a7 7 0 0 0 12 2l2-3"/></>, settings:<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>, external:<><path d="M14 4h6v6"/><path d="m20 4-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/></>
  };
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function groupCards(tracks:Track[],selected:LibraryView){ const seen=new Set<string>(); return tracks.filter(track=>{const key=selected==='artists'?track.artist:track.album;if(seen.has(key))return false;seen.add(key);return true;}); }
function uniqueAlbums(tracks:Track[]){return groupCards(tracks,'albums');}
function relativeTime(timestamp:number){const seconds=Math.max(0,Math.floor((Date.now()-timestamp)/1000));if(seconds<60)return 'now';if(seconds<3600)return `${Math.floor(seconds/60)}m`;if(seconds<86400)return `${Math.floor(seconds/3600)}h`;return `${Math.floor(seconds/86400)}d`;}
function localDateKey(date:Date){const y=date.getFullYear();const m=String(date.getMonth()+1).padStart(2,'0');const d=String(date.getDate()).padStart(2,'0');return `${y}-${m}-${d}`;}
function startOfLocalWeek(date:Date){const out=new Date(date);out.setHours(0,0,0,0);const day=out.getDay();const mondayOffset=day===0?-6:1-day;out.setDate(out.getDate()+mondayOffset);return out;}
function previousCompletedWeek(now:Date){const currentStart=startOfLocalWeek(now);const start=new Date(currentStart);start.setDate(start.getDate()-7);const end=new Date(start);end.setDate(end.getDate()+6);const endExclusive=new Date(currentStart);return {start,end,endExclusive,startKey:localDateKey(start)};}
function dateKeysBetween(start:Date,end:Date){const out:string[]=[];const cursor=new Date(start);cursor.setHours(0,0,0,0);const last=new Date(end);last.setHours(0,0,0,0);while(cursor<=last){out.push(localDateKey(cursor));cursor.setDate(cursor.getDate()+1);}return out;}
function currentWeekListening(daily:DailyListenSeconds){const start=startOfLocalWeek(new Date());return Array.from({length:7},(_,index)=>{const date=new Date(start);date.setDate(date.getDate()+index);const key=localDateKey(date);return {key,label:date.toLocaleDateString(undefined,{weekday:'short'}),fullLabel:date.toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'}),seconds:daily[key]??0};});}
function makeWeeklyRecap(start:Date,end:Date,daily:DailyListenSeconds,weekHistory:HistoryEntry[],tracks:Track[]):WeeklyRecap{
  const keys=dateKeysBetween(start,end);
  const totalSeconds=keys.reduce((sum,key)=>sum+(daily[key]??0),0);
  const bestDay=keys.reduce((best,key)=>(daily[key]??0)>(daily[best]??0)?key:best,keys[0]??'');
  const trackCounts=new Map<string,number>();for(const item of weekHistory)trackCounts.set(item.trackId,(trackCounts.get(item.trackId)??0)+1);
  const topTrackId=[...trackCounts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]??null;
  const artistCounts=new Map<string,number>();const albumCounts=new Map<string,number>();
  for(const item of weekHistory){const track=tracks.find(t=>t.id===item.trackId);if(!track)continue;artistCounts.set(track.artist,(artistCounts.get(track.artist)??0)+1);albumCounts.set(track.album,(albumCounts.get(track.album)??0)+1);}
  return {id:localDateKey(start),weekStart:localDateKey(start),weekEnd:localDateKey(end),totalSeconds,songStarts:weekHistory.length,uniqueTracks:new Set(weekHistory.map(h=>h.trackId)).size,topTrackId,topArtist:[...artistCounts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]??'',topAlbum:[...albumCounts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]??'',bestDay,bestDaySeconds:bestDay?(daily[bestDay]??0):0};
}
function formatCompactListen(total:number){const minutes=Math.floor(total/60);if(minutes<60)return `${minutes}m`;const hours=Math.floor(minutes/60);const rest=minutes%60;return rest?`${hours}h ${rest}m`:`${hours}h`;}
function formatWeekRange(startKey:string,endKey:string){const start=new Date(`${startKey}T12:00:00`);const end=new Date(`${endKey}T12:00:00`);return `${start.toLocaleDateString(undefined,{month:'short',day:'numeric'})} – ${end.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}`;}
function formatListenTime(total:number){const seconds=Math.max(0,Math.floor(total));const hours=Math.floor(seconds/3600);const minutes=Math.floor((seconds%3600)/60);if(hours>=100)return `${hours}h`;if(hours>0)return `${hours}h ${minutes}m`;return `${minutes}m`;}
function formatLongDuration(total:number){const h=Math.floor(total/3600);const m=Math.floor((total%3600)/60);return h?`${h} hr ${m} min`:`${m} min`;}
function formatTime(total:number){ if(!Number.isFinite(total)||total<0)return '0:00'; const minutes=Math.floor(total/60); const seconds=Math.floor(total%60); return `${minutes}:${seconds.toString().padStart(2,'0')}`; }
function shuffleArray<T>(items:T[]){const out=[...items];for(let i=out.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[out[i],out[j]]=[out[j],out[i]];}return out;}
function makeQueueLinear(current:Track,tracks:Track[]){const index=tracks.findIndex(track=>track.id===current.id);if(index<0)return tracks.filter(track=>track.path&&track.id!==current.id);return [...tracks.slice(index+1),...tracks.slice(0,index)].filter(track=>track.path);}

export default App;
