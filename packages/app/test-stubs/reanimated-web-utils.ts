// Reanimated 在 try/catch 里用 `require()` 加载这几个 react-native-web 工具。浏览器测试项目不打包，
// 没有 `require`，它们一直是 undefined，每次动画样式更新都会抛错。改成 ESM 再导出后，浏览器测试
// 才能挂载 `useAnimatedStyle`。
export { default as createReactDOMStyle } from "react-native-web/dist/exports/StyleSheet/compiler/createReactDOMStyle";
export {
  createTextShadowValue,
  createTransformValue,
} from "react-native-web/dist/exports/StyleSheet/preprocess";
