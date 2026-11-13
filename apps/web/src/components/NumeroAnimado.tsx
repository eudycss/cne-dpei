import { useEffect, useRef, useState } from 'react';
import { animate, useReducedMotion } from 'motion/react';

/**
 * Número que sube (o baja) hasta su valor en vez de saltar. Solo es decoración:
 * el primer render ya muestra el valor final (lectores de pantalla y pruebas
 * ven la cifra real) y con "reducir movimiento" nunca se anima.
 */
export function NumeroAnimado({ valor, duracion = 0.6 }: { valor: number; duracion?: number }) {
  const sinMovimiento = useReducedMotion();
  const [mostrado, setMostrado] = useState(valor);
  // Lo último que se dibujó: si el valor cambia a mitad de animación, sigue desde ahí.
  const actual = useRef(valor);

  useEffect(() => {
    if (sinMovimiento || actual.current === valor) {
      actual.current = valor;
      setMostrado(valor);
      return;
    }
    const control = animate(actual.current, valor, {
      duration: duracion,
      ease: 'easeOut',
      onUpdate: (n) => {
        actual.current = Math.round(n);
        setMostrado(actual.current);
      },
      onComplete: () => {
        actual.current = valor;
        setMostrado(valor);
      },
    });
    return () => control.stop();
  }, [valor, duracion, sinMovimiento]);

  return <>{mostrado}</>;
}
