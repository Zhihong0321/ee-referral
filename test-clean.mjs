function toCleanMessages(history, currentUserText) {
  const combined = [...history, { role: "user", text: currentUserText }];
  const result = [];

  for (const turn of combined) {
    if (result.length === 0 && turn.role === "assistant") continue;
    const last = result[result.length - 1];
    if (last && last.role === turn.role && typeof last.content === "string") {
      last.content = `${last.content}\n${turn.text}`;
    } else {
      result.push({ role: turn.role, content: turn.text });
    }
  }

  if (result.length === 0) {
    result.push({ role: "user", content: currentUserText });
  }
  return result;
}

const history = [
  { role: "user", text: "WhatsApp image received and converted to text.\nAmy VisionX Meter LCD Repair & Custom..." },
  { role: "assistant", text: "Done! Added Amy VisionX Meter LCD Repair & Custom (60105454405), Mantin, Negeri Sembilan. Do you have a preferred agent to handle this lead? — or reply skip." }
];

console.log(JSON.stringify(toCleanMessages(history, "To Zhi hong"), null, 2));
