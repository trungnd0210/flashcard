import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, doc, updateDoc, deleteDoc, query, orderBy, where } from 'firebase/firestore';

// Khai báo các biến toàn cục để ESLint không báo lỗi 'no-undef'
/* global __app_id, __firebase_config, __initial_auth_token */

// Global variables provided by the Canvas environment
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = {
  apiKey: "AIzaSyCnf0bO-ufQp9FJk-0O9Jnn7lOjuk9C3i4",
  authDomain: "flashcard-jiv.firebaseapp.com",
  projectId: "flashcard-jiv",
  storageBucket: "flashcard-jiv.firebasestorage.app",
  messagingSenderId: "420243020228",
  appId: "1:420243020228:web:cd2753636187e254276c91"
};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

function App() {
  const [words, setWords] = useState([]);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [showMeaning, setShowMeaning] = useState(false);
  const [newWord, setNewWord] = useState('');
  const [newMeaning, setNewMeaning] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [editingWordId, setEditingWordId] = useState(null);

  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState('');

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
        } else {
          try {
            if (initialAuthToken) {
              await signInWithCustomToken(firebaseAuth, initialAuthToken);
            } else {
              await signInAnonymously(firebaseAuth);
            }
          } catch (authError) {
            console.error("Lỗi xác thực Firebase:", authError);
            setError("Không thể xác thực người dùng. Vui lòng thử lại.");
          }
        }
        setIsAuthReady(true);
      });

      return () => unsubscribe();
    } catch (err) {
      console.error("Lỗi khởi tạo Firebase:", err);
      setError("Không thể khởi tạo ứng dụng. Vui lòng kiểm tra cấu hình.");
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

        // Fetch words, prioritizing those due for review
        // Note: Firestore orderBy needs an index for multiple fields.
        // For simplicity, we fetch all and sort in memory.
        const unsubscribe = onSnapshot(wordsCollectionRef, (snapshot) => {
          const fetchedWords = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));

          // Sort words: prioritize those with nextReviewDate in the past or null,
          // then by nextReviewDate ascending, then by timestamp for new words.
          fetchedWords.sort((a, b) => {
            const aNextReview = a.nextReviewDate ? a.nextReviewDate.toDate().getTime() : 0; // 0 means needs review now
            const bNextReview = b.nextReviewDate ? b.nextReviewDate.toDate().getTime() : 0;

            const now = new Date().getTime();

            // Prioritize overdue cards (nextReviewDate <= now)
            const aOverdue = aNextReview <= now && aNextReview !== 0;
            const bOverdue = bNextReview <= now && bNextReview !== 0;

            if (aOverdue && !bOverdue) return -1;
            if (!aOverdue && bOverdue) return 1;

            // If both are overdue or neither is, sort by nextReviewDate (earliest first)
            if (aNextReview < bNextReview) return -1;
            if (aNextReview > bNextReview) return 1;

            // If nextReviewDate is same or null, sort by original timestamp
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
      setError("Không thể truy cập dữ liệu. Vui lòng kiểm tra kết nối.");
    }
  }, [db, userId, isAuthReady]);

  // Function to handle adding or updating a word
  const handleSubmitWord = async () => {
    if (!newWord.trim() || !newMeaning.trim()) {
      setMessage("Vui lòng nhập cả từ và nghĩa.");
      return;
    }
    if (!db || !userId) {
      setMessage("Hệ thống chưa sẵn sàng. Vui lòng đợi.");
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
        });
        setMessage("Từ đã được cập nhật thành công!");
        setEditingWordId(null);
      } else {
        await addDoc(collection(db, `artifacts/${appId}/users/${userId}/words`), {
          word: newWord.trim(),
          meaning: newMeaning.trim(),
          category: newCategory.trim(),
          timestamp: new Date(),
          lastReviewed: null,
          correctCount: 0, // New field
          incorrectCount: 0, // New field
          interval: 0, // New field (in days)
          nextReviewDate: null, // New field
        });
        setMessage("Từ mới đã được thêm thành công!");
      }
      setNewWord('');
      setNewMeaning('');
      setNewCategory('');
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
    setMessage('');
  };

  const handleCancelEdit = () => {
    setEditingWordId(null);
    setNewWord('');
    setNewMeaning('');
    setNewCategory('');
    setMessage('');
  };

  const handleDeleteWord = async (wordId) => {
    if (!db || !userId) {
      setMessage("Hệ thống chưa sẵn sàng. Vui lòng đợi.");
      return;
    }

    // Replace with a custom modal for confirmation
    // IMPORTANT: Do NOT use window.confirm() in production apps for better UX and consistency.
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

  // Function to calculate next review date based on interval
  const calculateNextReviewDate = (currentInterval) => {
    const today = new Date();
    const nextDate = new Date(today);
    nextDate.setDate(today.getDate() + currentInterval);
    return nextDate;
  };

  // Handle user marking the answer as correct
  const handleAnswerCorrect = async () => {
    if (!currentWord || !db || !userId) return;

    setLoading(true);
    try {
      const wordRef = doc(db, `artifacts/${appId}/users/${userId}/words`, currentWord.id);
      const newCorrectCount = (currentWord.correctCount || 0) + 1;
      const newIncorrectCount = currentWord.incorrectCount || 0;
      let newInterval;

      if (currentWord.interval === 0) { // First correct answer
        newInterval = 1;
      } else {
        newInterval = currentWord.interval * 2; // Double the interval
      }

      await updateDoc(wordRef, {
        correctCount: newCorrectCount,
        incorrectCount: newIncorrectCount, // Keep incorrect count
        lastReviewed: new Date(),
        interval: newInterval,
        nextReviewDate: calculateNextReviewDate(newInterval),
      });
      setMessage("Tuyệt vời! Từ đã được cập nhật.");
      setTimeout(() => setMessage(''), 2000);
      setShowMeaning(false); // Hide meaning for next card
      handleNextCardOnly(); // Move to next card
    } catch (e) {
      console.error("Lỗi khi cập nhật trạng thái đúng:", e);
      setMessage("Lỗi: Không thể cập nhật trạng thái từ.");
    } finally {
      setLoading(false);
    }
  };

  // Handle user marking the answer as incorrect
  const handleAnswerIncorrect = async () => {
    if (!currentWord || !db || !userId) return;

    setLoading(true);
    try {
      const wordRef = doc(db, `artifacts/${appId}/users/${userId}/words`, currentWord.id);
      const newCorrectCount = currentWord.correctCount || 0; // Keep correct count
      const newIncorrectCount = (currentWord.incorrectCount || 0) + 1;
      const newInterval = 1; // Reset interval to 1 day for incorrect answers

      await updateDoc(wordRef, {
        correctCount: newCorrectCount,
        incorrectCount: newIncorrectCount,
        lastReviewed: new Date(),
        interval: newInterval,
        nextReviewDate: calculateNextReviewDate(newInterval),
      });
      setMessage("Không sao cả! Hãy ôn lại từ này sớm nhé.");
      setTimeout(() => setMessage(''), 2000);
      setShowMeaning(false); // Hide meaning for next card
      handleNextCardOnly(); // Move to next card
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
            border-radius: 1rem; /* rounded-xl */
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05); /* shadow-xl */
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
            padding: 1.5rem; /* p-6 */
            text-align: center;
            border-radius: 1rem; /* rounded-xl */
            background-color: white;
            color: #374151; /* text-gray-700 */
            font-size: 1.875rem; /* text-3xl */
            font-weight: 600; /* font-semibold */
          }
          .flashcard-front {
            background-color: #ffffff;
            color: #1f2937; /* text-gray-900 */
          }
          .flashcard-back {
            transform: rotateY(180deg);
            background-color: #edf2f7; /* bg-gray-100 */
            color: #1f2937; /* text-gray-900 */
          }
        `}
      </style>

      <header className="w-full max-w-4xl bg-white shadow-lg rounded-xl p-6 mb-8 text-center">
        <h1 className="text-4xl font-extrabold text-blue-600 mb-2">Học Từ Vựng</h1>
        <p className="text-lg text-gray-600">Thêm từ mới và học chúng với Flashcard!</p>
        {userId && (
          <p className="text-sm text-gray-500 mt-2">ID người dùng: <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">{userId}</span></p>
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

      {/* Phần thêm/chỉnh sửa từ mới */}
      <section className="w-full max-w-4xl bg-white shadow-lg rounded-xl p-6 mb-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">
          {editingWordId ? 'Chỉnh Sửa Từ' : 'Thêm Từ Mới'}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
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
        </div>
        <div className="flex space-x-4">
          <button
            onClick={handleSubmitWord}
            className="flex-1 bg-blue-600 text-white py-3 px-6 rounded-lg shadow-md hover:bg-blue-700 transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            {editingWordId ? 'Cập Nhật Từ' : 'Thêm Từ'}
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
                  {currentWord ? currentWord.word : 'Tải từ...'}
                  {currentWord?.category && (
                    <span className="absolute top-4 left-4 text-sm text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                      {currentWord.category}
                    </span>
                  )}
                </div>
                <div className="flashcard-face flashcard-back">
                  {currentWord ? currentWord.meaning : 'Tải nghĩa...'}
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
              <div className="flex justify-center space-x-4">
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
                  <th className="py-3 px-6 text-left">Nghĩa</th>
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
                    <td className="py-3 px-6 text-left">{word.meaning}</td>
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
    </div>
  );
}

export default App;
