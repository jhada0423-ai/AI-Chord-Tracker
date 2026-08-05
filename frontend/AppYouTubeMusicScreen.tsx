import React, { useState, useEffect } from 'react';
import {
    StyleSheet,
    View,
    Text,
    TouchableOpacity,
    ActivityIndicator,
    Alert,
    Linking,
    ScrollView,
    Platform
} from 'react-native';
import { WebView, WebViewErrorEvent } from 'react-native-webview';
import axios from 'axios';
import { RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';

// --- 네비게이션 스택 타입 정의 (이전과 동일) ---
type RootStackParamList = {
    Home: undefined;
    AppYouTubeMusicScreen: {
      title: string;
      artist: string;
      album: string;
      acrYouTubeVideoId?: string;
    };
    AppChordRecognition: { url: string; audioPath: string; chords: any };
};
// --- 타입 정의 끝 ---

type AppYouTubeMusicScreenRouteProp = RouteProp<RootStackParamList, 'AppYouTubeMusicScreen'>;
type AppYouTubeMusicScreenNavigationProp = StackNavigationProp<RootStackParamList, 'AppYouTubeMusicScreen'>;

type Props = {
  route: AppYouTubeMusicScreenRouteProp;
  navigation: AppYouTubeMusicScreenNavigationProp;
};

// ================================================
// ===== 수정된 YouTube iframe HTML 생성 함수 =====
// ================================================
const generateEmbedHtml = (videoId: string): string => `
  <!DOCTYPE html>
  <html>
  <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
      <style>
          /* 기본 마진/패딩 제거 및 박스 크기 계산 방식 설정 */
          * { margin: 0; padding: 0; box-sizing: border-box; }
          /* html, body가 뷰포트를 채우고 내용이 넘치지 않도록 함, 배경 투명 */
          html, body { height: 100%; width: 100%; overflow: hidden; background-color: transparent; }
          /* iframe이 body를 기준으로 절대 위치를 잡고 꽉 채우도록 함 */
          iframe {
              position: absolute;
              top: 0;
              left: 0;
              width: 100%;
              height: 100%;
              border: 0; /* 테두리 제거 */
          }
      </style>
  </head>
  <body>
      <iframe
          src="https://www.youtube.com/embed/${videoId}?playsinline=1" /* HTTPS 사용, 표준 /embed/ 경로 */
          title="YouTube video player"
          allow="picture-in-picture; web-share" /* web-share, PIP만 기본 허용, autoplay 제거 */
          allowFullScreen /* 전체 화면 허용 */
      ></iframe>
  </body>
  </html>
`;
// ================================================
// ================================================


const AppYouTubeMusicScreen: React.FC<Props> = ({ route, navigation }) => {
  // 파라미터 및 상태 (이전과 동일)
  console.log('[Screen Load] Received params:', JSON.stringify(route.params, null, 2));
  const { title = 'N/A', artist = 'N/A', album = 'N/A', acrYouTubeVideoId } = route.params || {};
  const [loading, setLoading] = useState(true);
  const [videoId, setVideoId] = useState<string | null>(acrYouTubeVideoId || null);
  const [webViewKey, setWebViewKey] = useState<number>(0);

  const YOUTUBE_API_KEY = 'AIzaSyCLwg_MrWi0QdMisrw31Qsvp4sDjMwC-hI';

  // useEffect (이전과 동일)
  useEffect(() => {
    console.log('[Effect Start] Initial State:', { videoId, title, artist, acrId: acrYouTubeVideoId });
    const fetchYouTubeVideo = async () => {
      if (acrYouTubeVideoId) {
        console.log('[Effect] Using ACR ID:', acrYouTubeVideoId);
        if (videoId !== acrYouTubeVideoId) {
            setVideoId(acrYouTubeVideoId);
            setWebViewKey(prev => prev + 1);
        }
        setLoading(false);
        return;
      }
      if (!YOUTUBE_API_KEY || YOUTUBE_API_KEY === 'YOUR_YOUTUBE_API_KEY') {
         console.error('[Effect] YouTube API Key missing or invalid!'); setLoading(false); return;
      }
      if (!title || title === 'N/A' || title === 'Unknown Title') {
         console.warn('[Effect] Cannot search YouTube without title.'); setLoading(false); return;
      }
      const searchQuery = encodeURIComponent(`${artist !== 'N/A' ? artist : ''} ${title}`);
      const apiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${searchQuery}&type=video&maxResults=5&key=${YOUTUBE_API_KEY}`;
      console.log('[Effect] Searching YouTube API:', apiUrl);
      try {
        const response = await axios.get(apiUrl);
        console.log('[Effect] YouTube API Response Status:', response.status);
        if (response.data.items && response.data.items.length > 0) {
          const foundVideoId = response.data.items[0].id.videoId;
          console.log('[Effect] Found YouTube Video ID:', foundVideoId);
          setVideoId(foundVideoId);
          setWebViewKey(prev => prev + 1);
        } else {
          console.log('[Effect] No YouTube results for:', decodeURIComponent(searchQuery));
          if (videoId !== null) setVideoId(null);
          setWebViewKey(prev => prev + 1);
        }
      } catch (error: any) {
        console.error('❌ [Effect] YouTube API Error:', error.response?.data || error.message);
        if (videoId !== null) setVideoId(null);
        setWebViewKey(prev => prev + 1);
      } finally {
        setLoading(false);
        console.log('[Effect End] Loading finished.');
      }
    };
    fetchYouTubeVideo();
  }, [title, artist, acrYouTubeVideoId]);

  console.log('[Render] Rendering with State:', { loading, videoId, webViewKey });

// AppYouTubeMusicScreen.tsx 파일 내

const openMusicLink = () => {
  if (videoId) {
    // --- 표준 YouTube 시청 URL (https 사용) ---
    const youtubeLink = `https://www.youtube.com/embed/${videoId}`; // <--- 여기를 수정!
    // -------------------------------------

    console.log('Attempting to open YouTube link:', youtubeLink); // 로그 확인용

    // URL을 열 수 있는지 확인 후 실행 (기존 로직 유지)
    Linking.canOpenURL(youtubeLink).then(supported => {
        if (supported) {
            Linking.openURL(youtubeLink);
        } else {
            console.log("Don't know how to open URI: " + youtubeLink);
            Alert.alert('Error', 'Cannot open YouTube link. Please ensure YouTube app or a browser is installed.');
        }
    }).catch(err => {
        console.error('❌ Error checking/opening YouTube link:', err);
        Alert.alert('Error', 'An error occurred while trying to open the link.');
    });
  }
};

  // WebView 에러 핸들러 (이전과 동일)
  const handleWebViewError = (event: WebViewErrorEvent) => {
    const { nativeEvent } = event;
    console.warn('WebView error:', nativeEvent);
  };

  // WebView 로드 종료 핸들러 (이전과 동일)
  const handleLoadEnd = () => {
      console.log(`[WebView] Load End triggered. Current videoId state: ${videoId}`);
  };

  return (
    <ScrollView contentContainerStyle={styles.scrollContainer}>
      <View style={styles.container}>
        {loading ? (
          <ActivityIndicator size="large" color="#1e90ff" style={styles.loader} />
        ) : videoId ? (
          <View style={styles.webViewContainer}>
            <WebView
              key={`webview-${webViewKey}`} // key 유지
              source={{ html: generateEmbedHtml(videoId) }} // source 유지
              style={styles.webView}
              originWhitelist={['*']} // originWhitelist 유지
              javaScriptEnabled={true}
              domStorageEnabled={true}
              allowsInlineMediaPlayback={true}
              // mediaPlaybackRequiresUserAction 제거 또는 true로 설정 (자동 재생 방지)
              // mediaPlaybackRequiresUserAction={true}
              allowsFullscreenVideo={true}
              onError={handleWebViewError} // 에러 핸들러 유지
              onLoadEnd={handleLoadEnd} // 로드 종료 핸들러 유지
              androidHardwareAccelerationDisabled={Platform.OS === 'android'}
              startInLoadingState={true}
              renderLoading={() => <ActivityIndicator color="#FFF" size="large" style={StyleSheet.absoluteFill} />}
            />
          </View>
        ) : (
          <View style={styles.noVideoContainer}>
             <Text style={styles.noVideoText}>YouTube video not available.</Text>
          </View>
        )}

        {/* 정보 표시 (이전과 동일) */}
        <View style={styles.infoContainer}>
            <Text style={styles.infoTitle}>Music Recognition Result</Text>
            <Text style={styles.infoText}><Text style={styles.boldText}>Title:</Text> {title}</Text>
            <Text style={styles.infoText}><Text style={styles.boldText}>Artist:</Text> {artist}</Text>
            <Text style={styles.infoText}><Text style={styles.boldText}>Album:</Text> {album}</Text>
        </View>

        {/* 버튼 (이전과 동일) */}
        {!loading && videoId && (
          <TouchableOpacity style={styles.button} onPress={openMusicLink}>
            <Text style={styles.buttonText}>Open on YouTube</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.button, styles.goBackButton]} onPress={() => navigation.goBack()}>
          <Text style={styles.buttonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

// --- 스타일 시트 (이전과 동일) ---
const styles = StyleSheet.create({
    scrollContainer: { flexGrow: 1 },
    container: { flex: 1, justifyContent: 'flex-start', alignItems: 'center', padding: 20, backgroundColor: '#f9f9f9' },
    loader: { marginTop: 50 },
    webViewContainer: { width: '100%', aspectRatio: 16/9, marginBottom: 20, borderRadius: 10, overflow: 'hidden', backgroundColor: '#000' }, // 배경 검정색 유지
    webView: { flex: 1, backgroundColor: 'transparent' }, // WebView 자체 배경 투명하게 변경
    noVideoContainer: { width: '100%', height: 200, justifyContent: 'center', alignItems: 'center', backgroundColor: '#eee', borderRadius: 10, marginBottom: 20 },
    noVideoText: { fontSize: 16, color: '#888', textAlign: 'center' },
    infoContainer: { width: '100%', padding: 15, backgroundColor: '#fff', borderRadius: 8, marginBottom: 20, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 3, elevation: 2 },
    infoTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 12, textAlign: 'center', color: '#333' },
    infoText: { fontSize: 16, color: '#555', marginBottom: 8, lineHeight: 22 },
    boldText: { fontWeight: '600' },
    button: { backgroundColor: '#1e90ff', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 25, marginVertical: 8, width: '85%', alignItems: 'center', shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 3, elevation: 3 },
    goBackButton: { backgroundColor: '#6c757d' },
    buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});


export default AppYouTubeMusicScreen;