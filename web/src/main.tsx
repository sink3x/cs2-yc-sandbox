import { render } from 'preact';
import { setHost, type Host } from './host';
import { SoundFiles } from './pages/SoundFiles';
import { Callouts } from './pages/Callouts';

// Реестр островов: имя → компонент. Старый интерфейс вызывает mount(name, element, host).
const islands: Record<string, () => preact.JSX.Element> = {
  'sound-files': () => <SoundFiles />,
  callouts: () => <Callouts />,
};

export function mount(name: string, el: HTMLElement, host: Host): () => void {
  setHost(host);
  const make = islands[name];
  if (!make) throw new Error(`unknown island: ${name}`);
  render(make(), el);
  return () => render(null, el);
}
