// test-stubs/reanimated-web-utils.ts 再导出的 react-native-web 内部模块，本身不带类型声明。
declare module "react-native-web/dist/exports/StyleSheet/compiler/createReactDOMStyle" {
  const createReactDOMStyle: (style: object) => object;
  export default createReactDOMStyle;
}

declare module "react-native-web/dist/exports/StyleSheet/preprocess" {
  export function createTransformValue(value: unknown): string;
  export function createTextShadowValue(style: object): string | undefined;
}
