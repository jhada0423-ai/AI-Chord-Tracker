import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Alert,
  Platform,
  PermissionsAndroid,
  ScrollView,
} from 'react-native';
// --- React Native Paper Import ---
import {
    Provider as PaperProvider,
    Button as PaperButton,
    TextInput as PaperTextInput,
    Text,
    ActivityIndicator as PaperActivityIndicator,
    DefaultTheme,
    Surface,
    useTheme
} from 'react-native-paper';
import RNFS from 'react-native-fs';
import { FFmpegKit, ReturnCode } from 'ffmpeg-kit-react-native';
import axios from 'axios';
import CryptoJS from 'crypto-js';
import { StackNavigationProp } from '@react-navigation/stack';
import { RouteProp } from '@react-navigation/native';

// --- 환경 설정 상수 임포트 (하드코딩 제거) ---
import { CHORD_API_URL, SEPARATION_API_URL } from './config';

// --- 네비게이션 스택 타입 정의 ---
type RootStackParamList = {
  Home: undefined;
  AppYouTubeMusicScreen: {
    title: string; artist: string; album: string; acrYouTubeVideoId?: string;
  };
  AppChordRecognition: {
    url: string;
    audioPath: string;
    apiResponse: any;
  };
  InstrumentMixer: {
    vocalsUrl: string;
    drumsUrl: string;
    bassUrl: string;
    otherUrl: string;
  };
};

type AppScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Home'>;
type AppScreenRouteProp = RouteProp<RootStackParamList, 'Home'>;

type Props = {
  navigation: AppScreenNavigationProp;
  route: AppScreenRouteProp;
};

// --- 커스텀 테마 정의 ---
const theme = {
  ...DefaultTheme,
  roundness: 8,
  colors: {
    ...DefaultTheme.colors,
    primary: '#626262',
    accent: '#a4a4a4',
    error: '#e74c3c',
    text: '#1c2a3a',
    background: '#ffffff',
    surface: '#ffffff',
    onSurface: '#1c2a3a',
  },
};

const AppContent: React.FC<Props> = ({ navigation, route }) => {
  const [recording, setRecording] = useState(false);
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [ffmpegInitialized, setFfmpegInitialized] = useState(false);
  const [url, setUrl] = useState('');
  const [processing, setProcessing] = useState(false);
  const [separationUrl, setSeparationUrl] = useState('');

  const accessKey = 'e519e7ed020c3d0fc97ec0066199801d';
  const accessSecret = '2hFRraVEUoyRhgIiaV03r8AEayEDovsSMtlt9M84';
  const requrl = 'https://identify-ap-southeast-1.acrcloud.com/v1/identify';

  // config.ts에서 가져온 동적 API 기본 주소 사용 (하드코딩 방지)
  const fastApiBaseUrl = CHORD_API_URL;
  const separationApiBaseUrl = SEPARATION_API_URL;

  const currentTheme = useTheme();

  useEffect(() => {
    const initializeFFmpegKit = async () => {
        try { 
          console.log('🎞️ Initializing FFmpegKit...');
          const session = await FFmpegKit.execute('-version');
          const returnCode = await session.getReturnCode();
          if (ReturnCode.isSuccess(returnCode)) { console.log('✅ FFmpegKit initialized.'); setFfmpegInitialized(true); }
          else { console.error('❌ FFmpegKit init failed:', await returnCode.getValue()); setFfmpegInitialized(false); Alert.alert("Error", "FFmpegKit init failed."); }
        } catch (error) { console.error('❌ FFmpegKit init error:', error); setFfmpegInitialized(false); Alert.alert("Error", "FFmpegKit init error."); }
    };
    initializeFFmpegKit();
  }, []);

  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
        try {
            const grants = await PermissionsAndroid.requestMultiple([ PermissionsAndroid.PERMISSIONS.RECORD_AUDIO ]);
            return grants[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED;
        } catch (err) { console.warn(err); return false; }
    } return true;
  };

  const startRecording = async () => {
    if (recording) return; if (!ffmpegInitialized) { Alert.alert('Not Ready', 'FFmpegKit not initialized.'); return; }
    const hasPermission = await requestPermissions(); if (!hasPermission) { Alert.alert('Permission Denied', 'Microphone permission needed.'); return; }
    const path = `${RNFS.DocumentDirectoryPath}/recording_${Date.now()}.aac`; setAudioPath(path);
    try {
        console.log(`🎤 Start Recording: ${path}`);
        const command = Platform.select({ ios: `-y -f avfoundation -i :0 ${path}`, android: `-y -f mediarecorder -i default -ac 1 -ar 44100 ${path}` });
        if (!command) throw new Error('Unsupported platform.'); setRecording(true);
        FFmpegKit.executeAsync(command, async (session) => {
            const returnCode = await session.getReturnCode();
            if (ReturnCode.isSuccess(returnCode)) { console.log('🏁 Record session ended unexpectedly.'); setRecording(false); }
            else if (ReturnCode.isCancel(returnCode)) { console.log('🏁 Record cancelled by stopRecording.'); }
            else { console.error(`❌ Record failed! rc=${await returnCode.getValue()}`); console.error("Logs:\n", await session.getLogsAsString()); Alert.alert('Record Error', `Recording failed.`); setRecording(false); setAudioPath(null); }
        });
    } catch (error: any) { console.error('❌ Start record error:', error); Alert.alert('Error', `Start record failed: ${error.message}`); setRecording(false); }
  };

  const stopRecording = async () => {
    if (!recording) return; console.log('🛑 Stopping recording...');
    try {
        await FFmpegKit.cancel();
        setRecording(false);
        if (audioPath) {
            const fileExists = await RNFS.exists(audioPath);
            if (fileExists) {
                console.log(`💾 File potentially saved: ${audioPath}. Uploading...`);
                setProcessing(true);
                const recognitionResult = await uploadToACRCloud(audioPath);
                setProcessing(false);
                if (recognitionResult) {
                    console.log('✅ ACRCloud Success:', recognitionResult);
                    navigation.navigate('AppYouTubeMusicScreen', recognitionResult);
                } else {
                    console.log('❌ ACRCloud failed or no result.');
                    Alert.alert('Recognition Failed','Could not recognize music.');
                }
            } else {
                console.warn(`⚠️ Audio file not found after stop: ${audioPath}`);
            }
            setAudioPath(null);
        } else {
            console.warn('⚠️ audioPath was null on stop.');
        }
    } catch (error: any) {
        console.error('❌ Stop record or upload error:', error);
        Alert.alert('Error', `Stop/Process audio failed: ${error.message}`);
        setRecording(false);
        setProcessing(false);
        setAudioPath(null);
    }
  };

  const createSignature = (timestamp: number): string => {
    const stringToSign = `POST\n/v1/identify\n${accessKey}\naudio\n1\n${timestamp}`;
    const hmac = CryptoJS.HmacSHA1(stringToSign, accessSecret);
    return CryptoJS.enc.Base64.stringify(hmac);
  };

  const uploadToACRCloud = async (path: string): Promise<{ title: string; artist: string; album: string; acrYouTubeVideoId?: string } | null> => {
    let tempPath = path;
    try {
        const timestamp = Math.floor(Date.now() / 1000); const signature = createSignature(timestamp);
        const fileStats = await RNFS.stat(tempPath); if (fileStats.size === 0) { console.warn('⚠️ Empty file upload attempt:', tempPath); return null; }
        const formData = new FormData(); formData.append('access_key', accessKey); formData.append('sample_bytes', fileStats.size.toString()); formData.append('timestamp', timestamp.toString()); formData.append('signature', signature); formData.append('data_type', 'audio'); formData.append('signature_version', '1'); formData.append('sample', { uri: `file://${tempPath}`, type: 'audio/aac', name: `recording_${Date.now()}.aac` });
        console.log('📡 Sending ACRCloud request...');
        const response = await axios.post(requrl, formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 20000 });
        console.log('🌐 ACRCloud Response Status:', response.data?.status);
        if (response.data?.status?.code === 0 && response.data.metadata?.music?.length > 0) {
            const musicData = response.data.metadata.music[0];
            const title = musicData?.title || 'Unknown Title'; const artist = musicData?.artists?.[0]?.name || 'Unknown Artist'; const album = musicData?.album?.name || 'Unknown Album'; const acrYouTubeVideoId = musicData?.external_metadata?.youtube?.vid;
            console.log(`🎵 Recognized: ${artist} - ${title}`); if(acrYouTubeVideoId) console.log(`   YouTube ID: ${acrYouTubeVideoId}`);
            return { title, artist, album, acrYouTubeVideoId };
        } else if (response.data?.status?.code === 1001) { console.log('🤷 No result from ACRCloud.'); return null; }
        else { console.warn('⚠️ ACRCloud API error or music not found:', response.data.status); return null; }
    } catch (error: any) {
        if (axios.isAxiosError(error)) { console.error('❌ ACRCloud Axios Error:', error.response?.status, error.response?.data || error.message); if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) { Alert.alert("Network Error", "ACRCloud request timed out."); } }
        else { console.error('❌ ACRCloud Upload Error:', error); }
        return null;
    } finally {
        if (tempPath && await RNFS.exists(tempPath)) {
            RNFS.unlink(tempPath)
                .then(() => console.log(`🗑️ Temp file deleted: ${tempPath}`))
                .catch(err => console.log("Temp file delete error:", err));
        }
    }
  };

  const handleYouTubeGo = async () => {
    console.log('[Analyze] Pressed.'); console.log(`[Analyze] URL: "${url}"`);
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/;
    if (!url.trim() || !youtubeRegex.test(url)) { Alert.alert('Invalid URL', 'Please enter a valid YouTube video URL.'); return; }
    const downloadUrl = `${fastApiBaseUrl}/download-audio`; const chordUrl = `${fastApiBaseUrl}/chord-recognition`;
    let targetPath: string | null = null;
    try {
      console.log('[Analyze] Processing...'); setProcessing(true);
      console.log(`[Analyze] 1. Downloading audio...`);
      const downloadResponse = await axios.post(downloadUrl, { url }, { timeout: 45000 });
      console.log('[Analyze] 2. Download Status:', downloadResponse.status);
      const audioBase64 = downloadResponse.data.audio_base64;
      if (!audioBase64 || typeof audioBase64 !== 'string' || audioBase64.length < 100) { console.error('[Analyze] Invalid audio data:', downloadResponse.data); throw new Error('Invalid audio data received.'); }
      console.log('[Analyze] 3. Received audio_base64.');
      const tempPath = `${RNFS.DocumentDirectoryPath}/youtube_audio_${Date.now()}.wav`;
      targetPath = tempPath;
      console.log(`[Analyze] 4. Saving to: ${targetPath}`); await RNFS.writeFile(targetPath, audioBase64, 'base64');
      console.log('[Analyze] 5. Audio saved.');
      const fileExists = await RNFS.exists(targetPath); if (!fileExists) { throw new Error('Failed to save audio file.'); }
      const fileStat = await RNFS.stat(targetPath); console.log(`[Analyze] 6. File size: ${fileStat.size} bytes.`); if (fileStat.size === 0) { throw new Error('Saved audio file is empty.'); }
      const formData = new FormData(); const fileUri = Platform.OS === 'android' ? `file://${targetPath}` : targetPath;
      formData.append('file', { uri: fileUri, type: 'audio/wav', name: 'youtube_audio.wav', });
      console.log('[Analyze] 7. FormData created.');
      console.log(`[Analyze] 8. Requesting chords...`);
      const chordResponse = await axios.post(chordUrl, formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 180000 });
      console.log('[Analyze] 9. Chord Status:', chordResponse.status); console.log('[Analyze] Chord Data:', JSON.stringify(chordResponse.data, null, 2));

      if (!targetPath || !chordResponse.data) { throw new Error('Missing data for navigation.'); }

      console.log('[Analyze] 10. Navigating...');
      const navigationPath = targetPath;
      targetPath = null;
      navigation.navigate('AppChordRecognition', { url: url, audioPath: navigationPath, apiResponse: chordResponse.data });
      console.log('[Analyze] 11. Navigation initiated.');

    } catch (error: any) {
      console.error('❌ [Analyze] ERROR:', error);
      if (axios.isAxiosError(error)) {
        console.error('[Analyze] Axios Details:', { msg: error.message, code: error.code, url: error.config?.url, status: error.response?.status, data: error.response?.data });
        if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) { Alert.alert('Timeout', 'Server request timed out. Please try again.'); }
        else if (error.message.includes('Network Error') || error.code === 'ERR_NETWORK') { Alert.alert('Network Error', `Cannot connect to server (${fastApiBaseUrl}). Check server status and network connection.`); }
        else { const serverError = error.response?.data?.error || error.response?.data?.detail || `Server responded with status ${error.response?.status}`; Alert.alert('Server Error', `Processing error: ${serverError}`); }
      } else { console.error('[Analyze] Non-Axios Error:', error.name, error.message); Alert.alert('Processing Error', `An unexpected error occurred: ${error.message || 'Unknown error'}`); }
    } finally {
      console.log('[Analyze] Finally block.'); setProcessing(false);
      if (targetPath && await RNFS.exists(targetPath)) {
        RNFS.unlink(targetPath)
            .then(() => console.log(`🗑️ Temp file deleted on error/exit: ${targetPath}`))
            .catch(err => console.log("Temp file delete error:", err));
      }
    }
  };

  const handleInstrumentSeparation = async () => {
    console.log('[Instrument Separation] Pressed.');
    if (!separationUrl.trim()) {
      Alert.alert('URL Needed', 'Please enter a YouTube URL for separation.');
      return;
    }
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/;
    if (!youtubeRegex.test(separationUrl)) {
      Alert.alert('Invalid URL', 'Please enter a valid YouTube URL.');
      return;
    }

    console.log('[Instrument Separation] URL:', separationUrl);
    setProcessing(true);

    try {
      const separateUrl = `${separationApiBaseUrl}/separate`;
      console.log(`[Instrument Separation] Requesting separation to ${separateUrl}`);

      const response = await axios.post(separateUrl,
        { youtube_url: separationUrl },
        { timeout: 300000 }
      );

      console.log('[Instrument Separation] API Response Status:', response.status);
      console.log('[Instrument Separation] API Response Data:', JSON.stringify(response.data, null, 2));

      const outputs = response.data?.outputs;
      if (outputs && outputs.vocals && outputs.drums && outputs.bass && outputs.other) {
        console.log('[Instrument Separation] Received valid output URLs.');
        navigation.navigate('InstrumentMixer', {
          vocalsUrl: outputs.vocals,
          drumsUrl: outputs.drums,
          bassUrl: outputs.bass,
          otherUrl: outputs.other,
        });
        console.log('[Instrument Separation] Navigation to InstrumentMixer initiated.');
      } else {
        console.error('[Instrument Separation] Invalid response format from server:', response.data);
        Alert.alert('분리 실패', '서버에서 유효한 응답을 받지 못했습니다. 응답 형식을 확인하세요.');
      }

    } catch (error: any) {
      console.error('❌ [Instrument Separation] ERROR:', error);
      if (axios.isAxiosError(error)) {
        console.error('[Instrument Separation] Axios Details:', {
          msg: error.message,
          code: error.code,
          url: error.config?.url,
          status: error.response?.status,
          data: error.response?.data
        });
        if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
          Alert.alert('시간 초과', '악기 분리 요청 시간이 초과되었습니다. 잠시 후 다시 시도하거나 짧은 곡으로 시도해보세요.');
        } else if (error.message.includes('Network Error') || error.code === 'ERR_NETWORK') {
          Alert.alert('네트워크 오류', `서버(${separationApiBaseUrl})에 연결할 수 없습니다. 서버 상태와 네트워크 연결, 방화벽 설정을 확인해주세요.`);
        } else {
          const serverError = error.response?.data?.detail || `서버 응답 코드 ${error.response?.status}`;
          Alert.alert('서버 오류', `악기 분리 중 오류 발생: ${serverError}`);
        }
      } else {
        console.error('[Instrument Separation] Non-Axios Error:', error.name, error.message);
        Alert.alert('처리 오류', `예상치 못한 오류 발생: ${error.message || '알 수 없는 오류'}`);
      }
    } finally {
      setProcessing(false);
      console.log('[Instrument Separation] Process finished.');
    }
  };

  return (
    <ScrollView contentContainerStyle={[styles.scrollContainer, { backgroundColor: currentTheme.colors.background }]}>
      <View style={styles.container}>
        <Text variant="headlineLarge" style={[styles.title, { color: currentTheme.colors.onSurface }]}>AI Chord Tracker</Text>

        <Surface style={styles.section} elevation={2}>
          <Text variant="titleLarge" style={[styles.sectionTitle, { color: currentTheme.colors.onSurface }]}>실시간 음악 찾기</Text>
          <View style={styles.buttonRow}>
            <PaperButton mode="contained" onPress={startRecording} disabled={recording || processing || !ffmpegInitialized} style={styles.buttonStyle} labelStyle={styles.buttonLabel} > 녹음 시작 </PaperButton>
            <PaperButton mode="outlined" onPress={stopRecording} disabled={!recording || processing} style={styles.buttonStyle} labelStyle={styles.buttonLabel} textColor={currentTheme.colors.error} > 녹음 중지 </PaperButton>
          </View>
          {recording && (
            <View style={styles.recordingIndicator}>
              <PaperActivityIndicator size="small" color={currentTheme.colors.error} />
              <Text style={[styles.recordingText, {color: currentTheme.colors.error}]}> 녹음 중...</Text>
            </View>
          )}
        </Surface>

        <Surface style={styles.section} elevation={2}>
          <Text variant="titleLarge" style={[styles.sectionTitle, { color: currentTheme.colors.onSurface }]}>나만의 코드 악보 만들기</Text>
          <View style={styles.inputContainer}>
            <PaperTextInput mode="outlined" label="YouTube URL 입력" value={url} onChangeText={setUrl} disabled={recording || processing} style={styles.input} autoCapitalize="none" keyboardType="url" />
            <PaperButton mode="contained" onPress={handleYouTubeGo} disabled={processing || recording || !url.trim()} style={[styles.buttonStyle, styles.sideButton]} labelStyle={styles.buttonLabel} > 생성 </PaperButton>
          </View>
        </Surface>

        <Surface style={styles.section} elevation={2}>
          <Text variant="titleLarge" style={[styles.sectionTitle, { color: currentTheme.colors.onSurface }]}>악기 분리 재생기</Text>
          <View style={styles.inputContainer}>
             <PaperTextInput mode="outlined" label="YouTube URL 입력" value={separationUrl} onChangeText={setSeparationUrl} disabled={recording || processing} style={styles.input} autoCapitalize="none" keyboardType="url" />
            <PaperButton mode="contained" onPress={handleInstrumentSeparation} disabled={processing || recording || !separationUrl.trim()} style={[styles.buttonStyle, styles.sideButton]} labelStyle={styles.buttonLabel} > 분리 </PaperButton>
          </View>
        </Surface>

        {processing && (
          <View style={styles.processingOverlay}>
            <PaperActivityIndicator animating={true} size="large" color="#fff" />
            <Text style={styles.processingText}>처리 중... (시간이 걸릴 수 있습니다)</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
};

const FinalApp: React.FC<Props> = (props) => {
  return (
    <PaperProvider theme={theme}>
        <AppContent {...props} />
    </PaperProvider>
  );
};

const styles = StyleSheet.create({
  scrollContainer: { flexGrow: 1 },
  container: { flex: 1, padding: 16 },
  title: { fontWeight: 'bold', marginVertical: 24, textAlign: 'center' },
  section: { backgroundColor: '#f5f5f5', borderRadius: 12, padding: 16, marginBottom: 20 },
  sectionTitle: { fontWeight: '600', marginBottom: 16, textAlign: 'center' },
  buttonRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 8 },
  buttonStyle: { marginHorizontal: 4 },
  sideButton: { marginLeft: 8 },
  buttonLabel: {},
  recordingIndicator: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 12, height: 24 },
  recordingText: { marginLeft: 8, fontSize: 14 },
  inputContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  input: { flex: 1, marginRight: 0, backgroundColor: 'transparent' },
  processingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.6)', justifyContent: 'center', alignItems: 'center', zIndex: 100 },
  processingText: { marginTop: 16, color: '#fff', fontSize: 16, fontWeight: 'bold' },
});

export default FinalApp;