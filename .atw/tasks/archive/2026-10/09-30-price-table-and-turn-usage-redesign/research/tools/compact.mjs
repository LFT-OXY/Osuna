import fs from "node:fs";
const a = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const skip = new Set(["label","tag","fontFamily"]);
const dflt = { borderTopColor: "rgb(0, 0, 0)", borderLeftColor: "rgb(0, 0, 0)", boxShadow: "none", gap: "normal", borderRadius: "0px", backgroundColor: "rgba(0, 0, 0, 0)", paddingTop:"0px",paddingRight:"0px",paddingBottom:"0px",paddingLeft:"0px", borderTopWidth:"0px", fontVariantNumeric:"normal", textAlign:"start" };
for (const o of a) {
  const parts = Object.entries(o).filter(([k,v]) => !skip.has(k) && dflt[k] !== v).map(([k,v]) => `${k}=${Array.isArray(v)? v.join(","): v}`);
  console.log(`- ${o.label}: ${parts.join("; ")}`);
}
