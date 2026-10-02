import { SlotText } from 'slot-text/react';
import 'slot-text/style.css';

/**
 * SlotText parte el texto en un <span> por carácter para animarlo, y el lector
 * de pantalla lo deletrea ("E-n t-r-á-n-s-i-t-o"). Aquí la animación queda
 * oculta para tecnologías de asistencia y el texto real va en un .sr-only.
 */
export function TextoAnimado({ text }: { text: string }) {
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        <SlotText text={text} />
      </span>
    </>
  );
}
