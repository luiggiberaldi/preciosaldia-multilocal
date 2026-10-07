const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    title: 'Precios Al Día Bodega',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
    },
  });

  // Ocultar la barra de menú nativa para dar una experiencia de aplicación limpia
  mainWindow.setMenuBarVisibility(false);

  // Cargar el index.html de la carpeta dist compilada según el entorno (desarrollo vs producción)
  const indexPath = app.isPackaged
    ? path.join(__dirname, 'dist/index.html')
    : path.join(__dirname, '../dist/index.html');

  mainWindow.loadFile(indexPath);

  // Manejar redimensionamiento o maximización
  mainWindow.maximize();

  // Atajos de teclado para desarrolladores (F12 / Ctrl+Shift+I)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (
      (input.control && input.shift && input.key.toLowerCase() === 'i') ||
      input.key === 'F12'
    ) {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
    // Permitir recargar con F5 o Ctrl+R
    if (
      (input.control && input.key.toLowerCase() === 'r') ||
      input.key === 'F5'
    ) {
      mainWindow.reload();
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Configurar comportamiento de ciclo de vida de Electron
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
