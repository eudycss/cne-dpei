// Permite importar imágenes como módulos (Metro las resuelve a un asset id)
declare module '*.png' {
  const content: number;
  export default content;
}
