import { useEffect, useState } from "react";
import "./App.css";

function App() {
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");

  const handlePhotoChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const selectedFile = event.target.files?.[0];

    if (!selectedFile) {
      return;
    }

    setPhotoFile(selectedFile);
  };

  useEffect(() => {
    if (!photoFile) {
      setPreviewUrl("");
      return;
    }

    const objectUrl = URL.createObjectURL(photoFile);
    setPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [photoFile]);

  return (
    <main className="container">
      <h1>📷 Box Photo Uploader</h1>

      <label className="photo-input">
        写真を撮る・選ぶ

        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handlePhotoChange}
        />
      </label>

      {photoFile && (
        <section className="preview-card">
          <img
            className="preview-image"
            src={previewUrl}
            alt="撮影した写真のプレビュー"
          />

          <p className="file-name">{photoFile.name}</p>

          <p>
            サイズ：
            {(photoFile.size / 1024 / 1024).toFixed(2)} MB
          </p>
        </section>
      )}

      {!photoFile && (
        <p className="empty-message">
          まだ写真は選択されていません。
        </p>
      )}
    </main>
  );
}

export default App;