import { render } from 'preact';
import { setHost, type Host } from './host';
import { SoundFiles } from './pages/SoundFiles';
import { Callouts } from './pages/Callouts';
import { Online } from './pages/Online';

// Реестр островов: имя → компонент. Старый интерфейс вызывает mount(name, element, host).
const islands: Record<string, () => preact.JSX.Element> = {
  'sound-files': () => <SoundFiles />,
  callouts: () => <Callouts />,
  online: () => <Online />,
};

export function mount(name: string, el: HTMLElement, host: Host): () => void {
  setHost(host);
  const make = islands[name];
  if (!make) throw new Error(`unknown island: ${name}`);
  render(make(), el);
  return () => render(null, el);
}
