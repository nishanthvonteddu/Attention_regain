export const SAMPLE_SOURCE = {
  title: "Focused Reading for Interview Preparation",
  goal: "prepare for interviews without drifting into passive rereading",
  body: `
Interview prep fails when reading stays passive. A candidate can spend hours with a system design article or a machine learning paper and still remember very little because the session feels productive without demanding retrieval. Attention needs a task, not just a source.

Working memory is narrow. When a page introduces several new ideas at once, the brain cannot hold all of them with equal clarity. Strong readers reduce load by chunking concepts, naming the main move in each section, and revisiting the thread before the details disappear.

Retrieval practice turns reading into memory. Instead of highlighting another sentence, the learner pauses and asks, "What was the claim here, and why did it matter?" That short pause forces reconstruction. Reconstruction is effortful, but the effort is exactly what makes later recall faster.

Spacing matters because familiarity is deceptive. When the same page is reread immediately, the text feels fluent, and that fluency can be mistaken for understanding. Returning later introduces a little friction, and the friction reveals what has and has not been stored.

Elaboration improves transfer. If a paragraph explains a tradeoff, the learner should connect it to a likely interview question, an exam prompt, or a real decision. A concept becomes more durable when it can be restated in a new setting without copying the original words.

Interleaving keeps attention awake. Mixing architecture, behavioral preparation, and core theory is often more demanding than finishing one topic in a single block, but the switching pressure teaches discrimination. The learner stops relying on pattern repetition and starts identifying what makes one concept different from another.
`.trim(),
};

export const PREVIEW_DECK = {
  documentTitle: "Preview Study Feed",
  goal: "see how the scroll format mixes quick reading with active recall",
  generationMode: "preview",
  model: "preview",
  focusTags: ["Retrieval", "Spacing", "Transfer", "Attention"],
  stats: {
    estimatedMinutes: 6,
    cardCount: 4,
    chunkCount: 4,
  },
  cards: [
    {
      id: "preview-1",
      kind: "glance",
      title: "Passive reading looks productive before it becomes useful",
      body: "The feed should not generate freeform content. It should keep every card anchored to the uploaded source so the user is still studying the original material.",
      excerpt:
        "The point is to keep every swipe tied back to the actual paper or notes.",
      citation: "Preview",
    },
    {
      id: "preview-2",
      kind: "recall",
      title: "Say it back before you scroll",
      body: "A quick pause matters more than another highlight.",
      question: "What changes when the user has to reconstruct the idea instead of rereading it?",
      answer:
        "Reconstruction creates retrieval effort, and that effort is what makes later recall easier than passive rereading.",
      citation: "Preview",
    },
    {
      id: "preview-3",
      kind: "application",
      title: "Tie the source to the real goal",
      body: "A study feed is stronger when each concept is pointed back at the exam, interview, or decision the user cares about.",
      question: "Where would this idea actually show up under pressure?",
      answer:
        "The user should be able to connect the concept to an interview question, an exam prompt, or a real decision instead of only recognizing the wording.",
      citation: "Preview",
    },
    {
      id: "preview-4",
      kind: "pitfall",
      title: "The easy trap is fluency",
      body: "When something feels smooth right away, users often confuse recognition with understanding.",
      question: "What does quick rereading usually hide?",
      answer:
        "It hides weak recall. The material feels familiar, but the user still cannot explain it cleanly when the source disappears.",
      citation: "Preview",
    },
  ],
};

