import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import Slider from '@react-native-community/slider';
// --- expo-av 대신 react-native-sound 임포트 ---
import Sound from 'react-native-sound';
// -------------------------------------------
import { StackNavigationProp } from '@react-navigation/stack';
import { RouteProp } from '@react-navigation/native';

// --- @expo/vector-icons 대신 react-native-vector-icons 임포트 ---
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import FontAwesome5 from 'react-native-vector-icons/FontAwesome5';
// ----------------------------------------------------------

// --- 네비게이션 타입 (이전과 동일) ---
type RootStackParamList = {
  Home: undefined;
  AppYouTubeMusicScreen: { /* ... */ };
  AppChordRecognition: { /* ... */ };
  SeparationInput: undefined;
  InstrumentMixer: {
    vocalsUrl: string;
    drumsUrl: string;
    bassUrl: string;
    otherUrl: string;
  };
};

type InstrumentMixerScreenNavigationProp = StackNavigationProp<RootStackParamList, 'InstrumentMixer'>;
type InstrumentMixerScreenRouteProp = RouteProp<RootStackParamList, 'InstrumentMixer'>;

type Props = {
  navigation: InstrumentMixerScreenNavigationProp;
  route: InstrumentMixerScreenRouteProp;
};

// --- react-native-sound 초기 설정 ---
Sound.setCategory('Playback');
// ------------------------------------

export default function InstrumentMixerScreen({ navigation, route }: Props) {
  const { vocalsUrl, drumsUrl, bassUrl, otherUrl } = route.params || {};
  const outputUrls = { vocals: vocalsUrl, drums: drumsUrl, bass: bassUrl, other: otherUrl };
  const instruments = (Object.keys(outputUrls) as (keyof typeof outputUrls)[]).filter(key => outputUrls[key]);

  console.log('[InstrumentMixer] Available Instruments:', instruments.join(', '));

  const [volumes, setVolumes] = useState({ vocals: 0.7, bass: 0.7, drums: 0.7, other: 0.7 });
  // --- Sound 객체 타입 변경 ---
  const soundRefs = useRef<{ [key: string]: Sound | null }>({ vocals: null, bass: null, drums: null, other: null });
  // --------------------------
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentPosition, setCurrentPosition] = useState(0); // 밀리초(ms) 단위 유지
  const [duration, setDuration] = useState(0); // 밀리초(ms) 단위 유지
  const positionIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // --- 볼륨 변경 핸들러 (setVolume 사용) ---
  const handleVolumeChange = (instrument: keyof typeof volumes, value: number) => {
    setVolumes((prev) => ({ ...prev, [instrument]: value }));
    soundRefs.current[instrument]?.setVolume(value); // setVolumeAsync 대신 setVolume 사용
  };
  // ---------------------------------------

  // --- 오디오 로드 함수 (react-native-sound 방식으로 변경) ---
  const loadAudio = async () => {
    setIsLoading(true);
    console.log('[InstrumentMixer] Starting audio load (using react-native-sound)...');

    let maxDurationMs = 0;

    const loadPromises = instruments.map((key) => {
      const uri = outputUrls[key];
      if (!uri) {
        console.warn(`[InstrumentMixer] URL for ${key} is missing.`);
        return Promise.resolve();
      }
      console.log(`[InstrumentMixer] Loading ${key} from: ${uri}`);

      return new Promise<void>((resolve, reject) => {
        const sound = new Sound(uri, '', (error) => {
          if (error) {
            console.error(`❌ [InstrumentMixer] ${key} 로드 실패:`, uri, error);
            soundRefs.current[key] = null;
            reject(error);
          } else {
            soundRefs.current[key] = sound;
            sound.setVolume(volumes[key]);
            const durationSeconds = sound.getDuration();
            const durationMs = durationSeconds > 0 ? durationSeconds * 1000 : 0;
            console.log(`[InstrumentMixer] ${key} loaded. Duration: ${durationMs}ms`);
            if (durationMs > 0) {
              maxDurationMs = Math.max(maxDurationMs, durationMs);
            }
            resolve();
          }
        });
      });
    });

    try {
        await Promise.all(loadPromises);
        console.log('[InstrumentMixer] All load promises settled.');
    } catch (error) {
        console.error("❌ [InstrumentMixer] Error during loading one or more sounds:", error);
        Alert.alert('오류', '일부 오디오 파일을 로드하는데 실패했습니다.');
    } finally {
        setIsLoading(false);
        setDuration(maxDurationMs);
        console.log('[InstrumentMixer] Audio load process finished. Total duration:', maxDurationMs, 'ms');

        if (instruments.every(key => soundRefs.current[key] === null)) {
            Alert.alert('오류', '로드할 수 있는 오디오 파일이 없습니다.\nURL을 확인해주세요.');
            setDuration(0);
        } else if (maxDurationMs === 0 && instruments.some(key => soundRefs.current[key] !== null)) {
            console.warn('[InstrumentMixer] Loaded audio has zero or invalid duration.');
            Alert.alert('경고', '로드된 오디오 길이가 0이거나 유효하지 않습니다.');
            setDuration(0);
        }
    }
  };
  // ---------------------------------------------------------

  // --- 재생 위치 업데이트 함수 (getCurrentTime 사용) ---
  const updatePosition = () => {
    const syncSourceKey = instruments.find(key => soundRefs.current[key] !== null);
    if (!syncSourceKey || !soundRefs.current[syncSourceKey]) {
        if (positionIntervalRef.current) clearInterval(positionIntervalRef.current);
        positionIntervalRef.current = null;
        setIsPlaying(false);
        setCurrentPosition(0);
        return;
    }

    const syncSound = soundRefs.current[syncSourceKey]!;
    syncSound.getCurrentTime((seconds, isCurrentlyPlaying) => {
        if (!soundRefs.current[syncSourceKey]) return;
        const currentPositionMs = seconds * 1000;
        setCurrentPosition(currentPositionMs);
    });
  };
  // ------------------------------------------------

  // --- 모든 트랙 동시 재생 (play 사용) ---
  const playAll = () => {
    if (isLoading || duration === 0) {
      console.log('[InstrumentMixer] Not ready to play.');
      return;
    }
    console.log('[InstrumentMixer] Playing all tracks...');
    let activePlayCount = 0;

    const onPlayComplete = (success: boolean, key: string) => {
        if (!soundRefs.current[key]) return;
        if (success) console.log(`[InstrumentMixer] ${key} finished playing`);
        else console.error(`[InstrumentMixer] ${key} playback failed`);

        const isAnyPlaying = instruments.some(instKey => soundRefs.current[instKey]?.isPlaying());
        if (!isAnyPlaying) {
            console.log('[InstrumentMixer] All playback finished.');
            setIsPlaying(false);
            setCurrentPosition(0);
            if (positionIntervalRef.current) {
                clearInterval(positionIntervalRef.current);
                positionIntervalRef.current = null;
            }
            instruments.forEach(instKey => {
                soundRefs.current[instKey]?.setCurrentTime(0);
                soundRefs.current[instKey]?.pause();
            });
        }
    };

    for (const key of instruments) {
      const sound = soundRefs.current[key];
      if (sound) {
        sound.setVolume(volumes[key]);
        sound.play((success) => onPlayComplete(success, key));
        activePlayCount++;
      }
    }

    if (activePlayCount > 0) {
        setIsPlaying(true);
        if (positionIntervalRef.current) clearInterval(positionIntervalRef.current);
        positionIntervalRef.current = setInterval(updatePosition, 250);
    } else {
        console.warn("[InstrumentMixer] No sound could be played.");
        setIsPlaying(false);
    }
    console.log('[InstrumentMixer] PlayAll finished setup.');
  };
  // --------------------------------------

  // --- 모든 트랙 동시 일시정지 (pause 사용) ---
  const pauseAll = () => {
    console.log('[InstrumentMixer] Pausing all tracks...');
    let pausedCount = 0;
    for (const key of instruments) {
      if (soundRefs.current[key]?.isPlaying()) {
        soundRefs.current[key]?.pause();
        pausedCount++;
      }
    }
    if (pausedCount > 0 || isPlaying) {
        setIsPlaying(false);
        if (positionIntervalRef.current) {
            clearInterval(positionIntervalRef.current);
            positionIntervalRef.current = null;
        }
        console.log(`[InstrumentMixer] ${pausedCount} tracks paused.`);
    }
  };
  // ----------------------------------------

  // --- 재생 위치 이동 (setCurrentTime 사용, 초 단위 변환) ---
  const seekAll = (milliseconds: number) => {
       if (isLoading || duration === 0) return;
       const syncSourceKey = instruments.find(key => soundRefs.current[key] !== null);
       if (!syncSourceKey || !soundRefs.current[syncSourceKey]) return;

       soundRefs.current[syncSourceKey]!.getCurrentTime((seconds) => {
           if (!soundRefs.current[syncSourceKey]) return;
           const currentSeconds = seconds;
           const targetSeconds = currentSeconds + milliseconds / 1000.0;
           const durationSeconds = duration / 1000.0;
           const newPositionSeconds = Math.max(0, Math.min(durationSeconds - 0.1, targetSeconds));
           console.log(`[InstrumentMixer] Seeking all tracks to ${newPositionSeconds.toFixed(2)}s`);
           instruments.forEach(key => {
               soundRefs.current[key]?.setCurrentTime(newPositionSeconds);
           });
           setCurrentPosition(newPositionSeconds * 1000);
       });
  };
  // ------------------------------------------------------

  // --- 슬라이더로 재생 위치 변경 (setCurrentTime 사용, 초 단위 변환) ---
  const onPlaybackSliderChange = (value: number) => {
      if (isLoading || duration === 0) return;
      const seekSeconds = value * (duration / 1000.0);
      console.log(`[InstrumentMixer] Seeking all tracks to ${seekSeconds.toFixed(2)}s (slider value: ${value})`);
      instruments.forEach(key => {
        soundRefs.current[key]?.setCurrentTime(seekSeconds);
      });
      setCurrentPosition(seekSeconds * 1000);
  };
  // -------------------------------------------------------------

  // 화면 로드 시 오디오 로드
  useEffect(() => {
    console.log('[InstrumentMixer] Component Mounted. URL Params:', route.params);
    const urlsProvided = instruments.length > 0;
    if (!urlsProvided) {
         console.error('[InstrumentMixer] No valid audio URLs provided in params.');
         Alert.alert('오류', '로드할 오디오 URL이 없습니다.');
         setIsLoading(false);
         return;
    }
    loadAudio();

    // 컴포넌트 언마운트 시 오디오 정리 (release 사용)
    return () => {
      console.log('[InstrumentMixer] Screen unmounting, unloading audio...');
      if (positionIntervalRef.current) {
          clearInterval(positionIntervalRef.current);
          positionIntervalRef.current = null;
      }
      instruments.forEach((key) => {
        soundRefs.current[key]?.release();
        soundRefs.current[key] = null;
      });
      console.log('[InstrumentMixer] Audio cleanup complete.');
    };
  }, [vocalsUrl, drumsUrl, bassUrl, otherUrl]);

  // --- 재생 시간 포맷 함수 (밀리초 입력 -> 분:초 출력, 이전과 동일) ---
  const formatTime = (millis: number) => {
      if (isNaN(millis) || millis < 0) return "0:00";
      const totalSeconds = Math.floor(millis / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };
  // -------------------------------------------------------------

  // --- UI 렌더링 ---
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.headerButtonText}>{'<'} 뒤로</Text>
        </TouchableOpacity>
        <Text style={[styles.headerText, styles.title]}>악기 분리 재생기</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* 로딩 인디케이터 */}
      {isLoading ? (
          <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#007aff" />
              <Text style={styles.loadingText}>오디오 로드 중...</Text>
          </View>
      ) : (
        // 컨텐츠 영역
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* 재생 슬라이더 */}
          <View style={styles.playbackContainer}>
            <Text style={styles.timeText}>
                {formatTime(currentPosition)} / {formatTime(duration)}
            </Text>
             <Slider
               style={styles.playbackSlider}
               minimumValue={0}
               maximumValue={1} // 슬라이더 값은 0 ~ 1
               value={duration > 0 ? currentPosition / duration : 0} // 현재 위치 비율
               onSlidingComplete={onPlaybackSliderChange} // 슬라이딩 완료 시 호출
               minimumTrackTintColor="#007aff"
               maximumTrackTintColor="#aaa"
               thumbTintColor="#007aff"
               disabled={duration === 0}
             />
          </View>

          {/* 악기 볼륨 슬라이더 */}
          <View style={styles.slidersContainer}>
            {instruments.map((inst) => (
              <View key={inst} style={styles.sliderRow}>
                <View style={styles.iconContainer}>
                  {/* --- 아이콘 컴포넌트 사용 (react-native-vector-icons) --- */}
                  {inst === 'vocals' && <MaterialCommunityIcons name="microphone" size={34} color="#333"/>}
                  {inst === 'bass' && <FontAwesome5 name="guitar" size={30} color="#333"/>}
                  {inst === 'drums' && <FontAwesome5 name="drum" size={34} color="#333"/>}
                  {inst === 'other' && <MaterialCommunityIcons name="music" size={34} color="#333"/>}
                  {/* ------------------------------------------------------- */}
                   <Text style={styles.instrumentName}>{inst.toUpperCase()}</Text>
                </View>
                <Slider
                  style={styles.volumeSlider}
                  minimumValue={0}
                  maximumValue={1}
                  value={volumes[inst]}
                  onValueChange={(val) => handleVolumeChange(inst, val)} // 실시간 볼륨 반영
                  minimumTrackTintColor="#007aff"
                  maximumTrackTintColor="#aaa"
                  thumbTintColor="#007aff"
                  disabled={soundRefs.current[inst] === null || duration === 0}
                />
                 <Text style={styles.volumeValueText}>{(volumes[inst]*100).toFixed(0)}%</Text>
              </View>
            ))}
          </View>

          {/* 재생 컨트롤 버튼 */}
          <View style={styles.controls}>
            <TouchableOpacity onPress={() => seekAll(-10000)} style={styles.controlBtn} disabled={isLoading || duration === 0}>
              <Text style={styles.controlText}>⏪ 10s</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={isPlaying ? pauseAll : playAll} style={styles.controlBtn} disabled={isLoading || duration === 0}>
              <Text style={styles.controlText}>{isPlaying ? '⏸️ Pause' : '▶️ Play'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => seekAll(10000)} style={styles.controlBtn} disabled={isLoading || duration === 0}>
              <Text style={styles.controlText}>10s ⏩</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

// --- 스타일 (이전과 동일) ---
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f2f2', padding: 15, paddingTop: 40, },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, },
  backButton: { padding: 8, }, headerButtonText: { color: '#007aff', fontSize: 16, fontWeight: 'bold', },
  headerText: { color: '#333', fontSize: 18, fontWeight: 'bold', }, title: { },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', },
  loadingText: { marginTop: 15, fontSize: 16, color: '#555', },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingBottom: 80, },
  playbackContainer: { alignItems: 'center', marginBottom: 30, width: '100%', },
  playbackSlider: { width: '95%', height: 40, }, timeText: { fontSize: 14, color: '#555', marginBottom: 5, },
  slidersContainer: { alignItems: 'center', marginBottom: 30, },
  sliderRow: { flexDirection: 'row', alignItems: 'center', width: '100%', marginBottom: 15, paddingHorizontal: 10, },
  iconContainer: { width: 70, alignItems: 'center', marginRight: 15, },
  instrumentName: { fontSize: 12, color: '#555', marginTop: 4, fontWeight: 'bold', },
  volumeSlider: { flex: 1, height: 40, },
  volumeValueText: { width: 40, textAlign: 'right', fontSize: 12, color: '#555', marginLeft: 5, },
  controls: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingVertical: 15, borderTopWidth: 1, borderColor: '#ddd', backgroundColor: '#eee', },
  controlBtn: { backgroundColor: '#007aff', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20, minWidth: 90, alignItems: 'center', },
  controlText: { color: '#fff', fontSize: 15, fontWeight: 'bold', },
});