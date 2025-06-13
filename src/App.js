import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, doc, updateDoc, deleteDoc, query, orderBy, where } from 'firebase/firestore';

// Khai báo các biến toàn cục để ESLint không báo lỗi 'no-undef'
/* global __app_id, __initial_auth_token */

// Global variables provided by the Canvas environment
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// DÁN CẤU HÌNH FIREBASE THỰC TẾ CỦA BẠN VÀO ĐÂY
// BẠN PHẢI THAY THẾ TẤT CẢ CÁC GIÁ TRỊ PLACEHOLDER BÊN DƯỚI BẰNG THÔNG TIN CỦA DỰ ÁN FIREBASE CỦA BẠN
const firebaseConfig = {
  apiKey: "AIzaSyCnf0bO-ufQp9FJk-0O9Jnn7lOjuk9C3i4", // <-- THAY THẾ BẰNG API KEY CỦA BẠN TỪ FIREBASE CONSOLE
  authDomain: "flashcard-jiv.firebaseapp.com", // <-- THAY THẾ BẰNG AUTH DOMAIN CỦA BẠN
  projectId: "flashcard-jiv",             // <-- THAY THẾ BẰNG PROJECT ID CỦA BẠN
  storageBucket: "flashcard-jiv.firebasestorage.app",
  messagingSenderId: "420243020228",
  appId: "1:420243020228:web:cd2753636187e254276c91"
  // measurementId: "YOUR_FIREBASE_MEASUREMENT_ID" // Có thể có hoặc không, nếu có thì thay thế
};
// Hết phần cấu hình Firebase của bạn

const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

function App() {
  const [words, setWords] = useState([]);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [showMeaning, setShowMeaning] = useState(false);
  const [newWord, setNewWord] = useState('');
  const [newMeaning, setNewMeaning] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newPronunciation, setNewPronunciation] = useState('');
  const [newExampleSentence, setNewExampleSentence] = useState('');
  const [editingWordId, setEditingWordId] = useState(null);

  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [userDisplayName, setUserDisplayName] = useState(null);
  const [userEmail, setUserEmail] = useState(null);

  const [isAuthReady, setIsAuthReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState('');
  const [geminiLoading, setGeminiLoading] = useState(false); // State for Gemini API loading
  const [suggestedRelatedWords, setSuggestedRelatedWords] = useState([]); // State for related words from Gemini

  // Initialize Firebase and handle authentication
  useEffect(() => {
    try {
      const app = initializeApp(firebaseConfig);
      const firestoreDb = getFirestore(app);
      const firebaseAuth = getAuth(app);

      setDb(firestoreDb);
      setAuth(firebaseAuth);

      const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
        if (user) {
          setUserId(user.uid);
          setUserDisplayName(user.displayName || user.email || 'Người dùng ẩn danh');
          setUserEmail(user.email || 'Ẩn danh');
          setLoading(false);
          setIsAuthReady(true);
        } else {
          try {
            if (initialAuthToken) {
              await signInWithCustomToken(firebaseAuth, initialAuthToken);
            } else {
              // await signInAnonymously(firebaseAuth); // Remove this if you only want Google Sign-in
            }
          } catch (authError) {
            console.error("Lỗi xác thực Firebase:", authError);
            if (authError.code === 'auth/network-request-failed') {
              setError("Lỗi kết nối mạng. Vui lòng kiểm tra internet của bạn.");
            } else if (authError.code === 'auth/invalid-api-key') {
              setError("Lỗi: Khóa API Firebase không hợp lệ. Vui lòng kiểm tra lại cấu hình Firebase.");
            } else if (authError.code === 'auth/unauthorized-domain') {
              setError("Lỗi: Miền ứng dụng chưa được ủy quyền. Vui lòng thêm miền này vào Firebase Console (Authentication -> Settings -> Authorized domains).");
            } else {
              setError(`Lỗi xác thực: ${authError.message}. Vui lòng kiểm tra Firebase Console.`);
            }
          }
          setLoading(false);
          setIsAuthReady(true);
        }
      });

      return () => unsubscribe();
    } catch (err) {
      console.error("Lỗi khởi tạo Firebase:", err);
      setError("Không thể khởi tạo ứng dụng. Vui lòng kiểm tra cấu hình Firebase của bạn.");
      setLoading(false);
    }
  }, []);

  // Fetch words from Firestore when auth is ready and db is available
  useEffect(() => {
    if (db && userId && isAuthReady) {
      setLoading(true);
      setError(null);
      try {
        const wordsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/words`);

        const unsubscribe = onSnapshot(wordsCollectionRef, (snapshot) => {
          const fetchedWords = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));

          fetchedWords.sort((a, b) => {
            const aNextReview = a.nextReviewDate ? a.nextReviewDate.toDate().getTime() : 0;
            const bNextReview = b.nextReviewDate ? b.nextReviewDate.toDate().getTime() : 0;

            const now = new Date().getTime();

            const aOverdue = aNextReview <= now && aNextReview !== 0;
            const bOverdue = bNextReview <= now && bNextReview !== 0;

            if (aOverdue && !bOverdue) return -1;
            if (!aOverdue && bOverdue) return 1;

            if (aNextReview < bNextReview) return -1;
            if (aNextReview > bNextReview) return 1;

            return (a.timestamp?.toDate() || 0) - (b.timestamp?.toDate() || 0);
          });

          setWords(fetchedWords);
          setLoading(false);
          if (currentWordIndex >= fetchedWords.length && fetchedWords.length > 0) {
            setCurrentWordIndex(0);
          } else if (fetchedWords.length === 0) {
            setCurrentWordIndex(0);
          }
        }, (err) => {
          console.error("Lỗi khi tải từ vựng:", err);
          setError("Không thể tải từ vựng. Vui lòng tải lại trang.");
          setLoading(false);
        });

        return () => unsubscribe();
      } catch (err) {
        console.error("Lỗi thiết lập lắng nghe Firestore:", err);
        setError("Lỗi khi thiết lập kết nối dữ liệu.");
        setLoading(false);
      }
    } else if (isAuthReady && !userId) {
      setLoading(false);
    }
  }, [db, userId, isAuthReady]);

  // Handle Google Sign-in
  const handleGoogleSignIn = async () => {
    if (!auth) {
      setMessage("Hệ thống xác thực chưa sẵn sàng.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      setMessage("Đăng nhập thành công!");
      setTimeout(() => setMessage(''), 3000);
    } catch (authError) {
      console.error("Lỗi đăng nhập Google:", authError);
      if (authError.code === 'auth/popup-closed-by-user') {
        setMessage("Đăng nhập bị hủy bởi người dùng.");
      } else if (authError.code === 'auth/cancelled-popup-request') {
        setMessage("Bạn đã mở nhiều cửa sổ đăng nhập. Vui lòng chỉ giữ một.");
      } else if (authError.code === 'auth/unauthorized-domain') {
        setError("Lỗi: Miền ứng dụng chưa được ủy quyền. Vui lòng thêm miền này vào Firebase Console (Authentication -> Settings -> Authorized domains).");
      }
      else {
        setError(`Lỗi đăng nhập Google: ${authError.message}. Vui lòng thử lại.`);
      }
    } finally {
      setLoading(false);
    }
  };

  // Handle Sign-out
  const handleSignOut = async () => {
    if (!auth) return;
    setLoading(true);
    setError(null);
    try {
      await signOut(auth);
      setUserId(null);
      setUserDisplayName(null);
      setUserEmail(null);
      setWords([]);
      setSuggestedRelatedWords([]);
      setMessage("Đã đăng xuất.");
      setTimeout(() => setMessage(''), 3000);
    } catch (signOutError) {
      console.error("Lỗi đăng xuất:", signOutError);
      setError("Lỗi khi đăng xuất. Vui lòng thử lại.");
    } finally {
      setLoading(false);
    }
  };

  // Function to call Gemini API for meaning and example sentence
  const suggestMeaningAndExample = async () => {
    if (!newWord.trim()) {
      setMessage("Vui lòng nhập từ bạn muốn gợi ý nghĩa.");
      return;
    }
    setGeminiLoading(true);
    setMessage('');
    setError(null);

    try {
      let chatHistory = [];
      // Cập nhật prompt để yêu cầu chi tiết hơn: nghĩa tiếng Việt, phiên âm IPA, câu ví dụ tiếng Anh, danh mục tiếng Việt
      const prompt = `Generate the Vietnamese meaning, IPA pronunciation, an English example sentence (concise), and a Vietnamese category (e.g., 'Danh từ', 'Động từ', 'Tính từ', 'Trạng từ') for the English word: "${newWord.trim()}". Provide the output as a JSON object with keys 'meaning_vi', 'pronunciation_ipa', 'exampleSentence_en', and 'category_vi'.`;
      chatHistory.push({ role: "user", parts: [{ text: prompt }] });

      const payload = {
        contents: chatHistory,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              meaning_vi: { type: "STRING" },
              pronunciation_ipa: { type: "STRING" },
              exampleSentence_en: { type: "STRING" },
              category_vi: { type: "STRING" }
            },
            propertyOrdering: ["meaning_vi", "pronunciation_ipa", "exampleSentence_en", "category_vi"]
          }
        }
      };

      // THAY THẾ CHỖ NÀY BẰNG API KEY THỰC TẾ CỦA BẠN TỪ GOOGLE CLOUD CONSOLE
      const apiKey = "AIzaSyBNKU6ZzXgtarPkW-ZWuEoNcO6rWvVqwl8"; // Đã điền API Key
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ message: 'Không thể phân tích phản hồi lỗi.' }));
        console.error("Lỗi gọi API Gemini (gợi ý nghĩa):", response.status, "Chi tiết:", errorBody);
        setError(`Lỗi từ AI: ${errorBody.error?.message || 'Không xác định.'} (Mã lỗi: ${response.status})`);
        return; // Dừng xử lý tiếp nếu có lỗi HTTP
      }

      const result = await response.json();

      if (result.candidates && result.candidates.length > 0 &&
          result.candidates[0].content && result.candidates[0].content.parts &&
          result.candidates[0].content.parts.length > 0) {
        const jsonText = result.candidates[0].content.parts[0].text;
        const parsedJson = JSON.parse(jsonText);

        setNewMeaning(parsedJson.meaning_vi || '');
        setNewPronunciation(parsedJson.pronunciation_ipa || '');
        setNewExampleSentence(parsedJson.exampleSentence_en || '');
        setNewCategory(parsedJson.category_vi || '');
        setMessage("Đã gợi ý nghĩa, phiên âm, ví dụ và danh mục từ AI.");
      } else {
        console.error("API Gemini (gợi ý nghĩa) trả về cấu trúc không mong muốn:", result);
        setMessage("Không thể gợi ý nghĩa/ví dụ. Phản hồi AI không hợp lệ.");
      }
    } catch (apiError) {
      console.error("Lỗi khi gọi API Gemini (gợi ý nghĩa):", apiError);
      setError("Lỗi kết nối với AI. Vui lòng kiểm tra internet và thử lại.");
    } finally {
      setGeminiLoading(false);
      setTimeout(() => setMessage(''), 3000);
    }
  };

  // Function to call Gemini API for related words
  const suggestRelatedWordsFromAI = async () => {
    if (!currentWord || !currentWord.word) {
      setMessage("Không có từ nào để gợi ý liên quan.");
      return;
    }
    setGeminiLoading(true);
    setSuggestedRelatedWords([]); // Clear previous suggestions
    setMessage('');
    setError(null);

    try {
      let chatHistory = [];
      // Cập nhật prompt để yêu cầu 5 từ tiếng Anh liên quan
      const prompt = `Suggest 5 related English words (single words, no phrases) to the English word: "${currentWord.word}". Provide the output as a JSON array of strings.`;
      chatHistory.push({ role: "user", parts: [{ text: prompt }] });

      const payload = {
        contents: chatHistory,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "ARRAY",
            items: { type: "STRING" }
          }
        }
      };

      // THAY THẾ CHỖ NÀY BẰNG API KEY THỰC TẾ CỦA BẠN TỪ GOOGLE CLOUD CONSOLE
      const apiKey = "AIzaSyBNKU6ZzXgtarPkW-ZWuEoNcO6rWvVqwl8"; // Đã điền API Key
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ message: 'Không thể phân tích phản hồi lỗi.' }));
        console.error("Lỗi gọi API Gemini (từ liên quan):", response.status, "Chi tiết:", errorBody);
        setError(`Lỗi từ AI: ${errorBody.error?.message || 'Không xác định.'} (Mã lỗi: ${response.status})`);
        return; // Dừng xử lý tiếp nếu có lỗi HTTP
      }

      const result = await response.json();

      if (result.candidates && result.candidates.length > 0 &&
          result.candidates[0].content && result.candidates[0].content.parts &&
          result.candidates[0].content.parts.length > 0) {
        const jsonText = result.candidates[0].content.parts[0].text;
        const parsedJson = JSON.parse(jsonText);
        setSuggestedRelatedWords(parsedJson);
        setMessage("Đã gợi ý từ liên quan từ AI.");
      } else {
        console.error("API Gemini (từ liên quan) trả về cấu trúc không mong muốn:", result);
        setMessage("Không thể gợi ý từ liên quan. Phản hồi AI không hợp lệ.");
      }
    } catch (apiError) {
      console.error("Lỗi khi gọi API Gemini cho từ liên quan:", apiError);
      setError("Lỗi kết nối với AI để gợi ý từ liên quan. Vui lòng kiểm tra internet và thử lại.");
    } finally {
      setGeminiLoading(false);
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const handleSubmitWord = async () => {
    if (!newWord.trim() || !newMeaning.trim()) {
      setMessage("Vui lòng nhập cả từ và nghĩa.");
      return;
    }
    if (!db || !userId) {
      setMessage("Bạn cần đăng nhập để thêm từ.");
      return;
    }

    setLoading(true);
    try {
      if (editingWordId) {
        const wordRef = doc(db, `artifacts/${appId}/users/${userId}/words`, editingWordId);
        await updateDoc(wordRef, {
          word: newWord.trim(),
          meaning: newMeaning.trim(),
          category: newCategory.trim(),
          pronunciation: newPronunciation.trim(),
          exampleSentence: newExampleSentence.trim(),
        });
        setMessage("Từ đã được cập nhật thành công!");
        setEditingWordId(null);
      } else {
        await addDoc(collection(db, `artifacts/${appId}/users/${userId}/words`), {
          word: newWord.trim(),
          meaning: newMeaning.trim(),
          category: newCategory.trim(),
          pronunciation: newPronunciation.trim(),
          exampleSentence: newExampleSentence.trim(),
          timestamp: new Date(),
          lastReviewed: null,
          correctCount: 0,
          incorrectCount: 0,
          interval: 0,
          nextReviewDate: null,
        });
        setMessage("Từ mới đã được thêm thành công!");
      }
      setNewWord('');
      setNewMeaning('');
      setNewCategory('');
      setNewPronunciation('');
      setNewExampleSentence('');
      setTimeout(() => setMessage(''), 3000);
    } catch (e) {
      console.error("Lỗi khi thêm/cập nhật từ mới:", e);
      setMessage("Lỗi: Không thể thực hiện thao tác. Vui lòng thử lại.");
    } finally {
      setLoading(false);
    }
  };

  const handleEditClick = (word) => {
    setEditingWordId(word.id);
    setNewWord(word.word);
    setNewMeaning(word.meaning);
    setNewCategory(word.category || '');
    setNewPronunciation(word.pronunciation || '');
    setNewExampleSentence(word.exampleSentence || '');
    setMessage('');
  };

  const handleCancelEdit = () => {
    setEditingWordId(null);
    setNewWord('');
    setNewMeaning('');
    setNewCategory('');
    setNewPronunciation('');
    setNewExampleSentence('');
    setMessage('');
  };

  const handleDeleteWord = async (wordId) => {
    if (!db || !userId) {
      setMessage("Bạn cần đăng nhập để xóa từ.");
      return;
    }
    if (!window.confirm("Bạn có chắc chắn muốn xóa từ này?")) {
      return;
    }

    setLoading(true);
    try {
      await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/words`, wordId));
      setMessage("Từ đã được xóa thành công!");
      setTimeout(() => setMessage(''), 3000);
    } catch (e) {
      console.error("Lỗi khi xóa từ:", e);
      setMessage("Lỗi: Không thể xóa từ. Vui lòng thử lại.");
    } finally {
      setLoading(false);
    }
  };

  const handleFlipCard = () => {
    setShowMeaning(!showMeaning);
  };

  const calculateNextReviewDate = (currentInterval) => {
    const today = new Date();
    const nextDate = new Date(today);
    nextDate.setDate(today.getDate() + currentInterval);
    return nextDate;
  };

  const handleAnswerCorrect = async () => {
    if (!currentWord || !db || !userId) return;

    setLoading(true);
    try {
      const wordRef = doc(db, `artifacts/${appId}/users/${userId}/words`, currentWord.id);
      const newCorrectCount = (currentWord.correctCount || 0) + 1;
      const newIncorrectCount = currentWord.incorrectCount || 0;
      let newInterval;

      if (currentWord.interval === 0) {
        newInterval = 1;
      } else {
        newInterval = currentWord.interval * 2;
      }

      await updateDoc(wordRef, {
        correctCount: newCorrectCount,
        incorrectCount: newIncorrectCount,
        lastReviewed: new Date(),
        interval: newInterval,
        nextReviewDate: calculateNextReviewDate(newInterval),
      });
      setMessage("Tuyệt vời! Từ đã được cập nhật.");
      setTimeout(() => setMessage(''), 2000);
      setShowMeaning(false);
      handleNextCardOnly();
    } catch (e) {
      console.error("Lỗi khi cập nhật trạng thái đúng:", e);
      setMessage("Lỗi: Không thể cập nhật trạng thái từ.");
    } finally {
      setLoading(false);
    }
  };

  const handleAnswerIncorrect = async () => {
    if (!currentWord || !db || !userId) return;

    setLoading(true);
    try {
      const wordRef = doc(db, `artifacts/${appId}/users/${userId}/words`, currentWord.id);
      const newCorrectCount = currentWord.correctCount || 0;
      const newIncorrectCount = (currentWord.incorrectCount || 0) + 1;
      const newInterval = 1;

      await updateDoc(wordRef, {
        correctCount: newCorrectCount,
        incorrectCount: newIncorrectCount,
        lastReviewed: new Date(),
        interval: newInterval,
        nextReviewDate: calculateNextReviewDate(newInterval),
      });
      setMessage("Không sao cả! Hãy ôn lại từ này sớm nhé.");
      setTimeout(() => setMessage(''), 2000);
      setShowMeaning(false);
      handleNextCardOnly();
    } catch (e) {
      console.error("Lỗi khi cập nhật trạng thái sai:", e);
      setMessage("Lỗi: Không thể cập nhật trạng thái từ.");
    } finally {
      setLoading(false);
    }
  };

  const handleNextCardOnly = () => {
    setShowMeaning(false);
    setCurrentWordIndex((prevIndex) => (prevIndex + 1) % words.length);
  };

  const handlePrevCardOnly = () => {
    setShowMeaning(false);
    setCurrentWordIndex((prevIndex) => (prevIndex - 1 + words.length) % words.length);
  };

  const currentWord = words[currentWordIndex];

  // Hàm xử lý khi nhấp vào một từ gợi ý
  const handleSelectSuggestedWord = (word) => {
    setNewWord(word); // Chuyển từ gợi ý vào ô "Từ"
    setSuggestedRelatedWords([]); // Xóa danh sách gợi ý sau khi chọn
    // Bạn có thể cân nhắc gọi suggestMeaningAndExample(word) ở đây để tự động điền các trường khác
    // nhưng để đơn giản, tôi sẽ không làm vậy để tránh gọi API tự động quá nhiều
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 font-inter text-gray-800 flex flex-col items-center">
      <style>
        {`
          .font-inter {
            font-family: 'Inter', sans-serif;
          }
          .flashcard-container {
            perspective: 1000px;
          }
          .flashcard {
            width: 100%;
            height: 250px;
            position: relative;
            transform-style: preserve-3d;
            transition: transform 0.6s;
            border-radius: 1rem;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
          }
          .flashcard.flipped {
            transform: rotateY(180deg);
          }
          .flashcard-face {
            position: absolute;
            width: 100%;
            height: 100%;
            backface-visibility: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 1.5rem;
            text-align: center;
            border-radius: 1rem;
            background-color: white;
            color: #374151;
            font-size: 1.875rem;
            font-weight: 600;
            flex-direction: column; /* Allow content to stack vertically */
            gap: 0.5rem; /* Space between elements */
          }
          .flashcard-front {
            background-color: #ffffff;
            color: #1f2937;
          }
          .flashcard-back {
            transform: rotateY(180deg);
            background-color: #edf2f7;
            color: #1f2937;
          }
          .flashcard-text-primary {
            font-size: 1.875rem; /* text-3xl */
            font-weight: 600; /* font-semibold */
            color: #1f2937;
          }
          .flashcard-text-secondary {
            font-size: 1.125rem; /* text-lg */
            font-weight: 400; /* font-normal */
            color: #4b5563;
          }
          .flashcard-text-tertiary {
            font-size: 0.875rem; /* text-sm */
            font-style: italic;
            color: #6b7280;
          }
        `}
      </style>

      <header className="w-full max-w-4xl bg-white shadow-lg rounded-xl p-6 mb-8 text-center">
        <h1 className="text-4xl font-extrabold text-blue-600 mb-2">Học Từ Vựng</h1>
        <p className="text-lg text-gray-600 mb-4">Thêm từ mới và học chúng với Flashcard!</p>

        {/* Thông tin người dùng và nút đăng nhập/đăng xuất */}
        {loading ? (
          <p className="text-sm text-gray-500">Đang tải...</p>
        ) : userId ? (
          <div className="flex flex-col sm:flex-row justify-center items-center space-y-2 sm:space-y-0 sm:space-x-4">
            <p className="text-md text-gray-700 font-semibold">
              Xin chào, {userDisplayName || userEmail}
            </p>
            <button
              onClick={handleSignOut}
              className="bg-red-500 text-white py-2 px-4 rounded-lg shadow-md hover:bg-red-600 transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 text-sm"
            >
              Đăng xuất
            </button>
          </div>
        ) : (
          <button
            onClick={handleGoogleSignIn}
            className="bg-blue-600 text-white py-2 px-4 rounded-lg shadow-md hover:bg-blue-700 transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 text-md font-semibold"
          >
            Đăng nhập bằng Google
          </button>
        )}
        {/* ID người dùng (chỉ hiển thị trong môi trường Canvas hoặc debug) */}
        {userId && (
          <p className="text-sm text-gray-500 mt-2">ID: <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">{userId}</span></p>
        )}
      </header>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4 w-full max-w-4xl" role="alert">
          <strong className="font-bold">Lỗi!</strong>
          <span className="block sm:inline"> {error}</span>
        </div>
      )}

      {message && (
        <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded relative mb-4 w-full max-w-4xl" role="alert">
          <span className="block sm:inline"> {message}</span>
        </div>
      )}

      {loading && (
        <div className="text-blue-600 text-lg mb-4">Đang tải...</div>
      )}

      {/* Các phần chức năng (Thêm từ, Flashcard, Quản lý) chỉ hiển thị khi đã đăng nhập */}
      {userId ? (
        <>
          {/* Phần thêm/chỉnh sửa từ mới */}
          <section className="w-full max-w-4xl bg-white shadow-lg rounded-xl p-6 mb-8">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">
              {editingWordId ? 'Chỉnh Sửa Từ' : 'Thêm Từ Mới'}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
              <input
                type="text"
                placeholder="Từ (ví dụ: 'hello')"
                value={newWord}
                onChange={(e) => setNewWord(e.target.value)}
                className="p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text"
                placeholder="Nghĩa (ví dụ: 'xin chào')"
                value={newMeaning}
                onChange={(e) => setNewMeaning(e.target.value)}
                className="p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text"
                placeholder="Danh mục (ví dụ: 'Động từ')"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text"
                placeholder="Phiên âm (ví dụ: /həˈləʊ/)"
                value={newPronunciation}
                onChange={(e) => setNewPronunciation(e.target.value)}
                className="p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text"
                placeholder="Câu ví dụ (không bắt buộc)"
                value={newExampleSentence}
                onChange={(e) => setNewExampleSentence(e.target.value)}
                className="p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 col-span-1 md:col-span-2 lg:col-span-1"
              />
            </div>
            <div className="flex space-x-4">
              <button
                onClick={handleSubmitWord}
                className="flex-1 bg-blue-600 text-white py-3 px-6 rounded-lg shadow-md hover:bg-blue-700 transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                {editingWordId ? 'Cập Nhật Từ' : 'Thêm Từ'}
              </button>
              <button
                onClick={suggestMeaningAndExample}
                disabled={geminiLoading}
                className="flex-1 bg-green-500 text-white py-3 px-6 rounded-lg shadow-md hover:bg-green-600 transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {geminiLoading ? 'Đang gợi ý...' : 'Gợi ý từ AI'}
              </button>
              {editingWordId && (
                <button
                  onClick={handleCancelEdit}
                  className="flex-1 bg-gray-400 text-white py-3 px-6 rounded-lg shadow-md hover:bg-gray-500 transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
                >
                  Hủy Chỉnh Sửa
                </button>
              )}
            </div>
          </section>

          {/* Phần Flashcard */}
          <section className="w-full max-w-4xl bg-white shadow-lg rounded-xl p-6 mb-8">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Học Flashcard</h2>
            {words.length === 0 ? (
              <p className="text-center text-gray-600 text-lg py-10">
                Bạn chưa có từ nào trong danh sách. Hãy thêm một vài từ để bắt đầu học!
              </p>
            ) : (
              <>
                <div className="flashcard-container w-full max-w-md mx-auto mb-6">
                  <div
                    className={`flashcard cursor-pointer ${showMeaning ? 'flipped' : ''}`}
                    onClick={handleFlipCard}
                  >
                    <div className="flashcard-face flashcard-front">
                      <span className="flashcard-text-primary">{currentWord ? currentWord.word : 'Tải từ...'}</span>
                      {currentWord?.pronunciation && (
                        <span className="flashcard-text-secondary text-gray-500">{currentWord.pronunciation}</span>
                      )}
                      {currentWord?.category && (
                        <span className="absolute top-4 left-4 text-sm text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                          {currentWord.category}
                        </span>
                      )}
                    </div>
                    <div className="flashcard-face flashcard-back">
                      <span className="flashcard-text-primary">{currentWord ? currentWord.meaning : 'Tải nghĩa...'}</span>
                      {currentWord?.exampleSentence && (
                        <span className="flashcard-text-tertiary text-gray-600 mt-2">"{currentWord.exampleSentence}"</span>
                      )}
                      {currentWord?.lastReviewed && (
                        <span className="absolute bottom-4 right-4 text-xs text-gray-400">
                          Ôn tập lần cuối: {new Date(currentWord.lastReviewed.toDate()).toLocaleDateString()}
                        </span>
                      )}
                      {currentWord?.nextReviewDate && (
                        <span className="absolute bottom-4 left-4 text-xs text-blue-400">
                          Ôn tập tiếp theo: {new Date(currentWord.nextReviewDate.toDate()).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex justify-center space-x-4 mb-4">
                  <button
                    onClick={handlePrevCardOnly}
                    disabled={words.length <= 1}
                    className="bg-gray-200 text-gray-800 py-3 px-6 rounded-lg shadow-md hover:bg-gray-300 transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Trước
                  </button>
                  <button
                    onClick={handleFlipCard}
                    className="bg-purple-600 text-white py-3 px-6 rounded-lg shadow-md hover:bg-purple-700 transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
                  >
                    Lật Thẻ
                  </button>
                  <button
                    onClick={handleNextCardOnly}
                    disabled={words.length <= 1}
                    className="bg-gray-200 text-gray-800 py-3 px-6 rounded-lg shadow-md hover:bg-gray-300 transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Tiếp
                  </button>
                </div>

                {showMeaning && (
                  <div className="flex justify-center space-x-4 mb-4">
                    <button
                      onClick={handleAnswerCorrect}
                      className="bg-green-500 text-white py-3 px-6 rounded-lg shadow-md hover:bg-green-600 transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
                    >
                      Tôi nhớ!
                    </button>
                    <button
                      onClick={handleAnswerIncorrect}
                      className="bg-red-500 text-white py-3 px-6 rounded-lg shadow-md hover:bg-red-600 transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                    >
                      Tôi không nhớ
                    </button>
                  </div>
                )}

                {/* Phần gợi ý từ liên quan từ AI */}
                {currentWord && (
                  <div className="flex justify-center mt-4">
                    <button
                      onClick={suggestRelatedWordsFromAI}
                      disabled={geminiLoading}
                      className="bg-indigo-500 text-white py-2 px-4 rounded-lg shadow-md hover:bg-indigo-600 transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 text-sm"
                    >
                      {geminiLoading ? 'Đang gợi ý...' : 'Gợi ý từ liên quan từ AI'}
                    </button>
                  </div>
                )}

                {suggestedRelatedWords.length > 0 && (
                  <div className="mt-6 p-4 bg-blue-50 rounded-lg shadow-inner">
                    <h3 className="text-lg font-semibold text-blue-700 mb-2">Từ liên quan được gợi ý:</h3>
                    <div className="flex flex-wrap gap-2">
                      {suggestedRelatedWords.map((relatedWord, index) => (
                        <span
                          key={index}
                          className="bg-blue-200 text-blue-800 px-3 py-1 rounded-full text-sm cursor-pointer hover:bg-blue-300 transition duration-200 ease-in-out"
                          onClick={() => handleSelectSuggestedWord(relatedWord)} // Thêm onClick handler
                        >
                          {relatedWord}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-center text-gray-600 mt-4">
                  {currentWordIndex + 1} / {words.length}
                </p>
              </>
            )}
          </section>

          {/* Phần quản lý từ vựng */}
          <section className="w-full max-w-4xl bg-white shadow-lg rounded-xl p-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Quản Lý Từ Vựng</h2>
            {words.length === 0 ? (
              <p className="text-center text-gray-600 text-lg py-10">
                Chưa có từ nào để quản lý. Hãy thêm một vài từ!
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full bg-white rounded-lg shadow-md">
                  <thead>
                    <tr className="bg-gray-100 text-gray-600 uppercase text-sm leading-normal">
                      <th className="py-3 px-6 text-left">Từ</th>
                      <th className="py-3 px-6 text-left">Phiên âm</th>
                      <th className="py-3 px-6 text-left">Nghĩa</th>
                      <th className="py-3 px-6 text-left">Câu ví dụ</th>
                      <th className="py-3 px-6 text-left">Danh mục</th>
                      <th className="py-3 px-6 text-left">Đúng</th>
                      <th className="py-3 px-6 text-left">Sai</th>
                      <th className="py-3 px-6 text-left">Khoảng</th>
                      <th className="py-3 px-6 text-left">Ôn tập lần cuối</th>
                      <th className="py-3 px-6 text-left">Ôn tập tiếp theo</th>
                      <th className="py-3 px-6 text-center">Hành động</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-700 text-sm font-light">
                    {words.map((word) => (
                      <tr key={word.id} className="border-b border-gray-200 hover:bg-gray-50">
                        <td className="py-3 px-6 text-left whitespace-nowrap">{word.word}</td>
                        <td className="py-3 px-6 text-left">{word.pronunciation || 'N/A'}</td>
                        <td className="py-3 px-6 text-left">{word.meaning}</td>
                        <td className="py-3 px-6 text-left">{word.exampleSentence || 'N/A'}</td>
                        <td className="py-3 px-6 text-left">{word.category || 'N/A'}</td>
                        <td className="py-3 px-6 text-left">{word.correctCount || 0}</td>
                        <td className="py-3 px-6 text-left">{word.incorrectCount || 0}</td>
                        <td className="py-3 px-6 text-left">{word.interval || 0} ngày</td>
                        <td className="py-3 px-6 text-left">
                          {word.lastReviewed ? new Date(word.lastReviewed.toDate()).toLocaleDateString() : 'Chưa ôn tập'}
                        </td>
                        <td className="py-3 px-6 text-left">
                          {word.nextReviewDate ? new Date(word.nextReviewDate.toDate()).toLocaleDateString() : 'N/A'}
                        </td>
                        <td className="py-3 px-6 text-center">
                          <div className="flex item-center justify-center space-x-2">
                            <button
                              onClick={() => handleEditClick(word)}
                              className="bg-yellow-500 text-white py-1 px-3 rounded-lg text-xs shadow-sm hover:bg-yellow-600 transition duration-200"
                            >
                              Chỉnh sửa
                            </button>
                            <button
                              onClick={() => handleDeleteWord(word.id)}
                              className="bg-red-500 text-white py-1 px-3 rounded-lg text-xs shadow-sm hover:bg-red-600 transition duration-200"
                            >
                              Xóa
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : (
        // Hiển thị thông báo khi chưa đăng nhập
        <section className="w-full max-w-4xl bg-white shadow-lg rounded-xl p-6 text-center">
          <p className="text-xl text-gray-700 font-semibold mb-4">
            Chào mừng bạn đến với ứng dụng Học Từ Vựng!
          </p>
          <p className="text-md text-gray-600 mb-6">
            Vui lòng đăng nhập bằng tài khoản Google để bắt đầu thêm từ mới và học Flashcard.
          </p>
          {loading ? (
             <p className="text-blue-500">Đang chờ đăng nhập...</p>
          ) : (
             <button
                onClick={handleGoogleSignIn}
                className="bg-blue-600 text-white py-3 px-6 rounded-lg shadow-md hover:bg-blue-700 transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 text-lg font-semibold"
              >
                Đăng nhập bằng Google
              </button>
          )}
        </section>
      )}
    </div>
  );
}

export default App;
