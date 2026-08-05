import React, { useEffect, useState, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Alert,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import Sound from 'react-native-sound';
import Slider from '@react-native-community/slider';
import YoutubePlayer from 'react-native-youtube-iframe';
import { RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';

// --- 타입 정의 (기존과 동일) ---
type ChordInfoFromAPI = string;

type MeasureFromAPI = {
  measure_number: number;
  start_time: number;
  end_time: number;
  chords: ChordInfoFromAPI[];
};

type ApiResponseData = {
  tempo: number | null;
  key_root: string | null;
  key_mode: string | null;
  time_signature_numerator?: number;
  time_signature_denominator?: number;
  measures: MeasureFromAPI[];
};

type RootStackParamList = {
  Home: undefined;
  AppYouTubeMusicScreen: { /* ... */ };
  AppChordRecognition: {
    url: string;
    audioPath: string;
    apiResponse: ApiResponseData;
  };
};

type AppChordRecognitionScreenRouteProp = RouteProp<RootStackParamList, 'AppChordRecognition'>;
type AppChordRecognitionScreenNavigationProp = StackNavigationProp<RootStackParamList, 'AppChordRecognition'>;

type Props = {
  route: AppChordRecognitionScreenRouteProp;
  navigation: AppChordRecognitionScreenNavigationProp;
};

// --- Helper Functions (기존과 동일) ---
function extractYouTubeId(url: string): string {
  try {
    const match = url.match(/v=([^&#]+)/);
    if (match && match[1]) return match[1];
    const shortExp = /youtu\.be\/([^?#]+)/;
    const shortMatch = url.match(shortExp);
    if (shortMatch && shortMatch[1]) return shortMatch[1];
  } catch (e) { console.warn('extractYouTubeId error:', e); }
  return '';
}

const AppChordRecognition: React.FC<Props> = ({ route, navigation }) => {
  const {
    url,
    audioPath,
    apiResponse,
  } = route.params || {};

  const [sound, setSound] = useState<Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [duration, setDuration] = useState<number>(0);
  const [currentPosition, setCurrentPosition] = useState<number>(0);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const [measuresData, setMeasuresData] = useState<MeasureFromAPI[]>([]);
  const [tempo, setTempo] = useState<number | null>(null);
  const [keyRoot, setKeyRoot] = useState<string>('');
  const [keyMode, setKeyMode] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [timeSignature, setTimeSignature] = useState<string>('4/4'); // 박자표 상태 추가

  // --- 데이터 처리 로직 (박자표 설정 추가) ---
  useEffect(() => {
    console.log('➡️ [FRONTEND] Received route.params:', JSON.stringify(route.params, null, 2));
    console.log('➡️ [FRONTEND] Extracted apiResponse:', JSON.stringify(apiResponse, null, 2));

    if (apiResponse && apiResponse.measures && Array.isArray(apiResponse.measures)) {
      setMeasuresData(apiResponse.measures);
      console.log(`✅ [DEBUG] Stored ${apiResponse.measures.length} measures in state.`);
      setTempo(apiResponse.tempo ?? null);
      setKeyRoot(apiResponse.key_root ?? '');
      setKeyMode(apiResponse.key_mode ?? '');
      // 박자표 설정 (기본값 4/4)
      const numerator = apiResponse.time_signature_numerator ?? 4;
      const denominator = apiResponse.time_signature_denominator ?? 4;
      setTimeSignature(`${numerator}/${denominator}`);
      setIsLoading(false);
    } else {
      console.warn('⚠️ [FRONTEND] apiResponse is invalid or missing measures.');
      setMeasuresData([]);
      setTempo(null); setKeyRoot(''); setKeyMode(''); setTimeSignature('4/4');
      setIsLoading(false);
    }
  }, [apiResponse]);

  // --- 오디오 로드 (기존과 동일) ---
  useEffect(() => {
    if (audioPath) {
      Sound.setCategory('Playback');
      const newSound = new Sound(audioPath, '', (error) => {
        if (error) { console.error('❌ [DEBUG] Sound loading error:', error); Alert.alert('오류', '오디오 파일을 로드하는데 실패했습니다.'); return; }
        console.log('✅ [DEBUG] Sound loaded successfully');
        setDuration(newSound.getDuration());
        setSound(newSound);
      });
      return () => { if (newSound) { newSound.release(); } if (intervalRef.current) { clearInterval(intervalRef.current); } };
    } else { console.warn('⚠️ [DEBUG] audioPath is null or undefined.'); }
  }, [audioPath]);

  // --- 재생/일시정지 (기존과 동일) ---
  const playPauseAudio = () => {
    if (!sound) { Alert.alert('오류', '오디오가 아직 로드되지 않았습니다.'); return; }
    if (isPlaying) {
      sound.pause(); setIsPlaying(false);
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    } else {
      sound.setSpeed(playbackRate);
      sound.play((success) => {
        if (!success) console.error('❌ [DEBUG] Playback failed.');
        setIsPlaying(false); setCurrentPosition(0);
        if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
        sound.setCurrentTime(0);
      });
      setIsPlaying(true);
      intervalRef.current = setInterval(() => {
        if (sound) {
          sound.getCurrentTime((sec, isPlayingUpdate) => {
             if (isPlayingUpdate) { setCurrentPosition(sec); }
             else if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; setIsPlaying(false); }
          });
        } else if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      }, 100);
    }
  };

  // --- 슬라이더 변경 핸들러 (기존과 동일) ---
  const handleSliderChange = (value: number) => { if (sound) { sound.setCurrentTime(value); setCurrentPosition(value); }};
  const handlePlaybackRateChange = (value: number) => { setPlaybackRate(value); if (sound && isPlaying) { sound.setSpeed(value); }};

  // ===============================================
  // --- 코드 표시 로직 수정: renderMeasures ---
  // ===============================================
  const renderMeasures = () => {
     if (isLoading) {
         return ( <View style={styles.loadingContainer}><ActivityIndicator size="large" color="#4682B4" /><Text style={styles.loadingText}>코드 분석 결과를 로딩 중입니다...</Text></View> );
     }
     if (!measuresData || measuresData.length === 0) {
         return <Text style={styles.noChordsText}>코드 데이터를 찾을 수 없거나 분석 결과가 없습니다.</Text>;
     }

     const currentTempo = tempo;
     const beatInterval = currentTempo && currentTempo > 0 ? 60.0 / currentTempo : null;
     // 박자표 분자 가져오기 (마디당 비트 수)
     const beatsPerMeasure = parseInt(timeSignature.split('/')[0], 10) || 4;

     return (
       <View style={styles.measuresGridContainer}>
         {measuresData.map((measure, measureIndex) => (
           // 각 마디를 하나의 행 + 마디 구분선으로 렌더링
           <View style={styles.measureRowContainer} key={`measure-row-${measure.measure_number || measureIndex}`}>
              {/* 마디 번호 표시 */}
              <View style={styles.measureNumberCell}>
                <Text style={styles.measureNumberText}>{measure.measure_number || measureIndex + 1}</Text>
              </View>

              {/* 코드 비트 표시 영역 */}
              <View style={styles.measureContentRow}>
                 {/* measure.chords 배열 길이를 박자표에 맞게 조정 (모자라면 'N' 추가) */}
                 {Array.from({ length: beatsPerMeasure }).map((_, beatIndex) => {
                    const chordString = measure.chords[beatIndex] || 'N'; // 없으면 'N'

                    // 'N' 코드는 '-' 기호로 표시
                    if (!chordString || typeof chordString !== 'string' || chordString === 'N') {
                      return (
                          <View key={`chord-${measureIndex}-${beatIndex}-empty`} style={[styles.chordBeatCell, styles.noChordCell]}>
                              <Text style={styles.noChordText}>-</Text>
                          </View>
                      );
                    }

                    // 하이라이트 로직 (오프셋 제거 또는 미세 조정)
                    let isCurrent = false;
                    const SYNC_OFFSET = 0.05; // 오프셋 줄이거나 0으로 테스트
                    const adjustedPosition = currentPosition + SYNC_OFFSET;

                    if (beatInterval) {
                        const approxBeatStart = measure.start_time + beatIndex * beatInterval;
                        const approxBeatEnd = measure.start_time + (beatIndex + 1) * beatInterval;
                        isCurrent = adjustedPosition >= approxBeatStart && adjustedPosition < approxBeatEnd;
                    }

                    return (
                      <View
                        key={`chord-${measureIndex}-${beatIndex}`}
                        style={[ styles.chordBeatCell, isCurrent && styles.currentChordHighlight ]}
                      >
                        <Text style={styles.chordText} numberOfLines={1} ellipsizeMode="clip">{chordString}</Text>
                      </View>
                    );
                 })}
              </View>
           </View>
         ))}
       </View>
     );
  };
  // ===============================================
  // --- 코드 표시 로직 수정 끝 ---
  // ===============================================

  const videoId = url ? extractYouTubeId(url) : '';

  return (
    <View style={styles.container}>
      {/* 상단 정보 표시 (박자표 추가) */}
      <View style={styles.infoContainer}>
        {!isLoading && tempo !== null ? ( <Text style={styles.infoText}>BPM: {tempo.toFixed(1)}</Text> ) : !isLoading ? ( <Text style={styles.infoText}>BPM: -</Text> ) : null }
        {!isLoading && keyRoot ? ( <Text style={styles.infoText}>KEY: {keyRoot} {keyMode ? `${keyMode}` : ''}</Text> ) : !isLoading ? ( <Text style={styles.infoText}>KEY: -</Text> ) : null }
        {!isLoading ? ( <Text style={styles.infoText}>TIME: {timeSignature}</Text> ) : null }
      </View>

      {/* 코드표 */}
      <View style={styles.chordDisplayArea}>
        <ScrollView style={styles.chordScroll} contentContainerStyle={styles.scrollContentContainer}>
          {renderMeasures()}
        </ScrollView>
      </View>

      {/* 오디오 컨트롤 (기존과 동일) */}
      {audioPath && sound && (
        <View style={styles.audioPlayerContainer}>
          <Slider style={styles.slider} minimumValue={0} maximumValue={duration} value={currentPosition} onSlidingComplete={handleSliderChange} minimumTrackTintColor="#4682B4" maximumTrackTintColor="#d3d3d3" thumbTintColor="#4682B4" />
          <Text style={styles.timeText}>{`${Math.floor(currentPosition / 60)}:${Math.floor(currentPosition % 60).toString().padStart(2, '0')} / ${Math.floor(duration / 60)}:${Math.floor(duration % 60).toString().padStart(2, '0')}`}</Text>
          <View style={styles.controlsRow}>
              <Slider style={styles.rateSlider} minimumValue={0.5} maximumValue={2.0} step={0.1} value={playbackRate} onValueChange={handlePlaybackRateChange} minimumTrackTintColor="#FFA500" maximumTrackTintColor="#d3d3d3" thumbTintColor="#FFA500" />
              <Text style={styles.rateText}>{playbackRate.toFixed(1)}x</Text>
              <TouchableOpacity style={styles.controlButton} onPress={playPauseAudio}>
                <Text style={styles.controlText}>{isPlaying ? '⏸️ Pause' : '▶️ Play'}</Text>
              </TouchableOpacity>
          </View>
        </View>
      )}

      {/* 유튜브 플레이어 */}
      {videoId !== '' && (
        <View style={styles.videoContainer}>
          <YoutubePlayer height={200} play={false} videoId={videoId} webViewStyle={styles.webView} />
        </View>
      )}
    </View>
  );
};

// --- Styles (대폭 수정) ---
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F8F8' }, // 연한 배경색
  infoContainer: {
    paddingVertical: 8,
    paddingHorizontal: 15,
    backgroundColor: '#EFEFEF', // 약간 다른 회색 톤
    flexDirection: 'row',
    justifyContent: 'space-between', // 공간 분배
    borderBottomWidth: 1,
    borderBottomColor: '#DDD',
  },
  infoText: { fontSize: 15, color: '#444', fontWeight: '500' },
  chordDisplayArea: { // 코드 표시 영역 분리
    flex: 3, // 비디오/오디오 영역과 비율 조정
    backgroundColor: '#FFFFFF', // 흰색 배경
  },
  chordScroll: { flex: 1, width: '100%' },
  scrollContentContainer: {
    paddingVertical: 10, // 상하 여백
    paddingHorizontal: 8, // 좌우 여백
  },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  loadingText: { marginTop: 12, fontSize: 16, color: '#555' },
  noChordsText: { textAlign: 'center', fontSize: 16, color: '#888', marginTop: 30 },

  // 마디 관련 스타일
  measuresGridContainer: { flexDirection: 'column' }, // 마디는 세로로 쌓임
  measureRowContainer: {
    flexDirection: 'row', // 마디 번호 + 코드 행
    alignItems: 'center', // 세로 중앙 정렬
    marginBottom: 8, // 마디 간격
    borderBottomWidth: 1, // 마디 아래 구분선
    borderBottomColor: '#EEE', // 연한 구분선
    paddingBottom: 8, // 구분선과 내용 사이 여백
  },
  measureNumberCell: {
    width: 35, // 마디 번호 영역 너비
    alignItems: 'center',
    justifyContent: 'center',
    paddingRight: 5, // 코드와의 간격
  },
  measureNumberText: {
    fontSize: 13,
    color: '#666',
    fontWeight: 'bold',
  },
  measureContentRow: { // 실제 코드들이 들어가는 행
    flex: 1, // 남은 공간 모두 사용
    flexDirection: 'row',
    // justifyContent: 'space-around', // 비트들을 균등하게 배치 (선택 사항)
    alignItems: 'center',
    borderLeftWidth: 1.5, // 마디 시작 세로선 (바 라인 효과)
    borderLeftColor: '#AAA',
    paddingLeft: 8, // 세로선과 코드 간격
  },

  // 코드 비트 셀 스타일
  chordBeatCell: {
    // flex: 1, // 비트를 균등 분할하려면 사용 (justifyContent: 'space-around'와 함께)
    minWidth: 60, // 최소 너비 보장 (긴 코드 이름 고려)
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginHorizontal: 3, // 코드 셀 간격
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 4,
    backgroundColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  noChordCell: { // '-' 표시되는 셀 스타일
    backgroundColor: '#F0F0F0', // 약간 다른 배경색
    borderColor: '#E0E0E0',
  },
  noChordText: { // '-' 텍스트 스타일
    fontSize: 15,
    color: '#999',
    fontWeight: 'bold',
  },
  chordText: { // 실제 코드 텍스트
    fontSize: 15,
    color: '#333',
    fontWeight: 'bold',
    textAlign: 'center',
  },
  currentChordHighlight: { // 현재 재생 코드 하이라이트
    backgroundColor: '#ADD8E6', // 연한 하늘색 (기존 노란색보다 부드러움)
    borderColor: '#4682B4', // 약간 진한 테두리
    borderWidth: 1.5, // 테두리 강조
    // elevation: 2, // 그림자 효과 (선택 사항)
  },

  // 오디오/비디오 영역 스타일
  audioPlayerContainer: {
    paddingVertical: 10,
    paddingHorizontal: 15,
    backgroundColor: '#F0F0F0', // 배경색 통일감
    borderTopWidth: 1,
    borderColor: '#DDD',
  },
  slider: { width: '100%', height: 30, marginBottom: 0 }, // 여백 조정
  timeText: { fontSize: 13, color: '#555', textAlign: 'center', marginBottom: 8 },
  controlsRow: { // 속도 슬라이더와 버튼을 한 줄에 배치
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 5,
  },
  rateSlider: { flex: 1, height: 30, marginHorizontal: 10 }, // 버튼과의 간격
  rateText: { fontSize: 13, color: '#FFA500', fontWeight: '500', marginRight: 10 },
  controlButton: {
    paddingVertical: 8,
    paddingHorizontal: 15,
    backgroundColor: '#4682B4', // 하이라이트 색상과 통일감
    borderRadius: 5,
  },
  controlText: { fontSize: 15, fontWeight: 'bold', color: '#fff' },
  videoContainer: {
    flex: 2, // 비디오 영역 비율 조정
    borderTopWidth: 1,
    borderColor: '#CCC',
    backgroundColor: '#000', // 비디오 배경은 검은색
  },
  webView: { },
});

export default AppChordRecognition;