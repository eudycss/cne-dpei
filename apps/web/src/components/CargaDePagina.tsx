import { Component, Suspense, createRef, type ErrorInfo, type ReactNode } from 'react';
import { Cargando } from './Cargando';
import { ErrorCargaPagina } from '../lib/lazy-page';

interface Props {
  children: ReactNode;
  /** Al cambiar (p. ej. la ruta), un aviso de error anterior se descarta y se reintenta. */
  claveReinicio?: string;
}

/**
 * Envuelve las páginas que se cargan bajo demanda: muestra el indicador mientras
 * llega su archivo y, si algo falla, un aviso con botón para recargar en vez de
 * dejar la pantalla en blanco.
 */
export function CargaDePagina({ children, claveReinicio }: Props) {
  return (
    <ErrorDeCarga claveReinicio={claveReinicio}>
      <Suspense
        fallback={
          <div className="carga-de-pagina">
            <Cargando />
          </div>
        }
      >
        {children}
      </Suspense>
    </ErrorDeCarga>
  );
}

interface Estado {
  error: Error | null;
}

class ErrorDeCarga extends Component<Props, Estado> {
  state: Estado = { error: null };
  private readonly aviso = createRef<HTMLDivElement>();

  static getDerivedStateFromError(error: Error): Estado {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('No se pudo mostrar la página', error, info.componentStack);
    // El menú sigue visible: llevar el foco al aviso para que el lector de pantalla y el teclado lo encuentren.
    this.aviso.current?.focus();
  }

  componentDidUpdate(previas: Props) {
    if (this.state.error && previas.claveReinicio !== this.props.claveReinicio) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const mensaje =
      error instanceof ErrorCargaPagina
        ? 'No se pudo cargar esta sección. Revise su conexión e intente de nuevo.'
        : 'Ocurrió un error al mostrar esta sección.';
    return (
      <div role="alert" ref={this.aviso} tabIndex={-1} className="carga-de-pagina carga-de-pagina--error">
        <p>
          <strong>Error:</strong> {mensaje}
        </p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>
          Recargar
        </button>
      </div>
    );
  }
}
