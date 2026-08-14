// `react-test-renderer` ships without published type declarations and
// `@types/react-test-renderer` is not a dependency of this app. It is only
// used from test files (via react-test-renderer's untyped JS API, resolved
// as a transitive dependency of jest-expo). This covers just the surface
// area our specs actually import/use, so `tsc --noEmit` type-checks without
// adding a new dependency.
declare module 'react-test-renderer' {
  import type { ReactElement } from 'react';

  export interface TestInstance {
    instance: any;
    type: any;
    props: Record<string, any>;
    parent: TestInstance | null;
    children: Array<TestInstance | string>;
    find(predicate: (node: TestInstance) => boolean): TestInstance;
    findAll(predicate: (node: TestInstance) => boolean): TestInstance[];
    findByType(type: any): TestInstance;
    findAllByType(type: any): TestInstance[];
    findByProps(props: Record<string, any>): TestInstance;
    findAllByProps(props: Record<string, any>): TestInstance[];
  }

  export interface ReactTestRenderer {
    toJSON(): any;
    toTree(): any;
    update(nextElement: ReactElement): void;
    unmount(): void;
    getInstance(): any;
    root: TestInstance;
  }

  export function create(element: ReactElement, options?: Record<string, any>): ReactTestRenderer;
  export function act(callback: () => void | Promise<void>): Promise<void>;
}
