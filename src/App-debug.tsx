function App() {
  console.log('🚀 App component is rendering!');
  
  return (
    <div style={{ 
      height: '100vh', 
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      color: 'white',
      fontFamily: 'Arial, sans-serif'
    }}>
      <h1 style={{ fontSize: '3rem', marginBottom: '1rem' }}>
        🎯 LEF File Viewer
      </h1>
      <p style={{ fontSize: '1.5rem', textAlign: 'center' }}>
        React App is Working! ✅
      </p>
      <div style={{ 
        background: 'rgba(255,255,255,0.1)', 
        padding: '2rem', 
        borderRadius: '10px',
        marginTop: '2rem',
        textAlign: 'center'
      }}>
        <p>✓ React mounted successfully</p>
        <p>✓ JavaScript is executing</p>
        <p>✓ Styles are applying</p>
        <p style={{ marginTop: '1rem', fontSize: '0.9rem', opacity: 0.8 }}>
          Check console for debug logs
        </p>
      </div>
    </div>
  );
}

export default App;
