import "./App.css";

function App() {
  return (
    <main className="container">
      <h1>📷 Box Photo Uploader</h1>

      <input
        type="file"
        accept="image/*"
        capture="environment"
      />
    </main>
  );
}

export default App;