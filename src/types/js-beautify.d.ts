declare module 'js-beautify' {
  const beautify: {
    (src: string, options?: Record<string, unknown>): string;
    html: (src: string, options?: Record<string, unknown>) => string;
    css: (src: string, options?: Record<string, unknown>) => string;
    js: (src: string, options?: Record<string, unknown>) => string;
  };
  export default beautify;
}
