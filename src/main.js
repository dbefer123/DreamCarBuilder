import '@fontsource/exo-2/300.css';
import '@fontsource/exo-2/400.css';
import '@fontsource/exo-2/500.css';
import '@fontsource/exo-2/600.css';
import '@fontsource/exo-2/700-italic.css';
import '@fontsource/exo-2/400-italic.css';
import '@fontsource/exo-2/600-italic.css';
import './ui/styles.css';
import { App } from './app.js';
import { MainMenu } from './ui/mainMenu.js';

const app = new App();
window.dcb = app;
app.start();
app.setScreen(new MainMenu(app)).catch((e) => {
  console.error(e);
  app.toast(`Startup failed: ${e.message}`, 10000);
});
