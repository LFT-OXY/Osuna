process.on("message", (message) => {
  if (message?.type !== "osuna_frame") return;
  process.send?.(message);
});
