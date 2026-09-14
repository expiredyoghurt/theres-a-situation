// Built-in tutorial cases. These always work, even before a teacher has
// uploaded anything via the admin tool. Scoring logic in index.js reads
// these the same way it reads a row from the `cases` D1 table.

function svgDataUrl(svg) {
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

const RECYCLING_FAIR_SVG = `
<svg viewBox="0 0 640 420" xmlns="http://www.w3.org/2000/svg" font-family="Georgia, serif">
  <rect width="640" height="420" fill="#EFE3C0"/>
  <rect x="14" y="14" width="612" height="392" fill="none" stroke="#7A5C2E" stroke-width="4"/>
  <rect x="26" y="26" width="588" height="368" fill="none" stroke="#7A5C2E" stroke-width="1"/>
  <text x="320" y="78" text-anchor="middle" font-size="34" font-weight="bold" fill="#26401F" letter-spacing="2">RECYCLING FAIR</text>
  <text x="320" y="108" text-anchor="middle" font-size="15" fill="#5B4321" font-style="italic">Riverbank Primary School</text>
  <circle cx="320" cy="185" r="55" fill="#DCE9C8" stroke="#3E6B2E" stroke-width="3"/>
  <path d="M320 150 l14 24 h-28 z" fill="#3E6B2E"/>
  <path d="M355 200 l-10 26 -20 -14 z" fill="#3E6B2E"/>
  <path d="M285 200 l30 12 -6 24 z" fill="#3E6B2E"/>
  <g font-size="15" fill="#26401F">
    <text x="90" y="270">&#8226; Date: Saturday, 14 March</text>
    <text x="90" y="295">&#8226; Time: 9am &#8211; 12pm</text>
    <text x="90" y="320">&#8226; Venue: School Hall</text>
    <text x="90" y="345">&#8226; Volunteers needed to man booths &amp; sort recyclables</text>
    <text x="90" y="370">&#8226; Sign up with Mr Kumar (Gen. Office) by 7 March</text>
  </g>
  <text x="530" y="345" font-size="11" fill="#7A5C2E" text-anchor="middle">Free popcorn for</text>
  <text x="530" y="358" font-size="11" fill="#7A5C2E" text-anchor="middle">first 50 visitors!</text>
  <text x="320" y="400" text-anchor="middle" font-size="11" fill="#7A5C2E">Proudly part of Global Recycling Month</text>
</svg>`.trim();

const SPORTS_DAY_SVG = `
<svg viewBox="0 0 640 420" xmlns="http://www.w3.org/2000/svg" font-family="Verdana, sans-serif">
  <rect width="640" height="420" fill="#FDF3E7"/>
  <rect x="14" y="14" width="612" height="392" fill="none" stroke="#C0392B" stroke-width="4" rx="10"/>
  <text x="320" y="80" text-anchor="middle" font-size="32" font-weight="bold" fill="#C0392B">SPORTS DAY!</text>
  <text x="320" y="106" text-anchor="middle" font-size="14" fill="#7A2E22">Come cheer for the Yellow House!</text>
  <polygon points="320,140 335,175 372,175 342,197 353,232 320,210 287,232 298,197 268,175 305,175" fill="#F1C40F" stroke="#B7950B" stroke-width="2"/>
  <g font-size="15" fill="#5B2A1E">
    <text x="90" y="270">&#8226; Date: Friday, 21 March</text>
    <text x="90" y="295">&#8226; Time: 2pm &#8211; 5pm</text>
    <text x="90" y="320">&#8226; Venue: School Field</text>
    <text x="90" y="345">&#8226; Bring your own water bottle &amp; house T-shirt</text>
    <text x="90" y="370">&#8226; Class photo right after the closing ceremony</text>
  </g>
  <text x="530" y="345" font-size="11" fill="#7A2E22" text-anchor="middle">Ice-cream truck</text>
  <text x="530" y="358" font-size="11" fill="#7A2E22" text-anchor="middle">will be around!</text>
</svg>`.trim();

export const DEMO_CASES = [
  {
    id: "demo-1",
    title: "Case #1 — The Recycling Fair (Tutorial)",
    formal: true,
    imageData: svgDataUrl(RECYCLING_FAIR_SVG),
    taskText:
      "You saw this notice about your school's Recycling Fair, and you are unable to attend on the actual day. Write an email to Mr Kumar, the teacher-in-charge, to explain your situation and suggest another way you can help out. Use the notice for more details.",
    taskChunks: [
      { id: "c1", text: "You saw this notice about your school's Recycling Fair, and you are unable to attend on the actual day.", type: "context" },
      { id: "c2", text: "Write an email to Mr Kumar, the teacher-in-charge,", type: "audience" },
      { id: "c3", text: "to explain your situation and suggest another way you can help out.", type: "purpose" },
      { id: "c4", text: "Use the notice for more details.", type: "other" },
    ],
    stimulusPoints: [
      { id: "s1", text: "Date: Saturday, 14 March, 9am to 12pm", relevant: true },
      { id: "s2", text: "Venue: School Hall", relevant: true },
      { id: "s3", text: "Volunteers needed to man booths and sort recyclables", relevant: true },
      { id: "s4", text: "Sign up with Mr Kumar by 7 March", relevant: true },
      { id: "s5", text: "Fair is part of Global Recycling Month", relevant: false },
      { id: "s6", text: "Free popcorn for the first 50 visitors", relevant: false },
    ],
    ownContentPrompt:
      "Suggest ONE way you could still help with the Recycling Fair, even though you can't be there on the day itself.",
    ownContentKeywords: [
      ["donate", "contribute items", "give recyclables", "bring recyclable items"],
      ["poster", "posters", "banner", "design", "publicity"],
      ["help before", "prepare", "pack", "set up", "sort at home", "sort in advance"],
      ["social media", "promote", "spread the word", "announce", "advertise"],
    ],
    components: [
      {
        key: "salutation", label: "Salutation",
        options: [
          { id: "a", text: "Dear Mr Kumar," },
          { id: "b", text: "Hi Kumar," },
          { id: "c", text: "Dear Sir/Madam," },
          { id: "d", text: "Dear Vice-Principal," },
        ],
      },
      {
        key: "purpose", label: "Purpose",
        options: [
          { id: "a", text: "I am writing to let you know that I am unable to attend the Recycling Fair on 14 March, and to suggest another way I could help." },
          { id: "b", text: "I am writing to invite you to my birthday party next month." },
          { id: "c", text: "I am writing to complain that the Recycling Fair was cancelled." },
          { id: "d", text: "Just letting you know I probably won't come, no biggie." },
        ],
      },
      {
        key: "keyinfo1", label: "Key information — your situation",
        options: [
          { id: "a", text: "Unfortunately, I have a family commitment on that day and will not be able to attend." },
          { id: "b", text: "I simply do not feel like attending the Fair." },
          { id: "c", text: "The Fair sounds boring so I will not be going." },
          { id: "d", text: "I will be attending another school's fair instead." },
        ],
      },
      {
        key: "keyinfo2", label: "Key information — your suggestion",
        options: [
          { id: "a", text: "I would like to help by preparing publicity posters beforehand and sorting recyclable items in advance." },
          { id: "b", text: "I do not think I can help in any other way." },
          { id: "c", text: "Perhaps someone else can just do my part for me." },
          { id: "d", text: "I will think about it and let you know never." },
        ],
      },
      {
        key: "keyinfo3", label: "Key information — logistics",
        options: [
          { id: "a", text: "I understand volunteers are needed to man the booths and that sign-ups close on 7 March, so I hope this suggestion still reaches you in time." },
          { id: "b", text: "I heard the sign-up deadline was actually next year." },
          { id: "c", text: "I am not sure if sign-ups are even necessary." },
          { id: "d", text: "Please cancel the Fair since I cannot make it." },
        ],
      },
      {
        key: "filler", label: "Additional context",
        options: [
          { id: "a", text: "I have always enjoyed helping out at school events and hope to contribute meaningfully despite my absence." },
          { id: "b", text: "By the way, did you catch the football match last night?" },
          { id: "c", text: "This is the third time I have missed a school event this year." },
          { id: "d", text: "I am also writing to ask for extra homework." },
        ],
      },
      {
        key: "signoff", label: "Sign-off",
        options: [
          { id: "a", text: "Yours sincerely," },
          { id: "b", text: "Yours faithfully," },
          { id: "c", text: "Love," },
          { id: "d", text: "Best wishes always forever," },
        ],
      },
    ],
    answerKey: {
      components: { salutation: "a", purpose: "a", keyinfo1: "a", keyinfo2: "a", keyinfo3: "a", filler: "a", signoff: "a" },
      paragraphBreaks: ["purpose", "keyinfo1", "filler", "signoff"],
    },
    model_letter:
      "Dear Mr Kumar,\n\nI am writing to let you know that I am unable to attend the Recycling Fair on 14 March, and to suggest another way I could help.\n\nUnfortunately, I have a family commitment on that day and will not be able to attend. I would like to help by preparing publicity posters beforehand and sorting recyclable items in advance. I understand volunteers are needed to man the booths and that sign-ups close on 7 March, so I hope this suggestion still reaches you in time.\n\nI have always enjoyed helping out at school events and hope to contribute meaningfully despite my absence.\n\nYours sincerely,\nA concerned pupil",
  },
  {
    id: "demo-2",
    title: "Case #2 — Sports Day Mix-up (Tutorial)",
    formal: false,
    imageData: svgDataUrl(SPORTS_DAY_SVG),
    taskText:
      "You saw this notice about your school's Sports Day. Your friend Wei Jie missed the announcement and does not know the details. Write an email to Wei Jie to share the details and invite him to join your house group.",
    taskChunks: [
      { id: "c1", text: "You saw this notice about your school's Sports Day.", type: "context" },
      { id: "c2", text: "Your friend Wei Jie missed the announcement and does not know the details.", type: "other" },
      { id: "c3", text: "Write an email to Wei Jie", type: "audience" },
      { id: "c4", text: "to share the details and invite him to join your house group.", type: "purpose" },
    ],
    stimulusPoints: [
      { id: "s1", text: "Date: Friday, 21 March, 2pm to 5pm", relevant: true },
      { id: "s2", text: "Venue: School Field", relevant: true },
      { id: "s3", text: "Bring water bottle and house T-shirt", relevant: true },
      { id: "s4", text: "Class photo right after closing ceremony", relevant: true },
      { id: "s5", text: "An ice-cream truck will be around", relevant: false },
      { id: "s6", text: "Yellow House is defending champion", relevant: false },
    ],
    ownContentPrompt:
      "Suggest ONE fun thing you and Wei Jie could do together before or after Sports Day.",
    ownContentKeywords: [
      ["practice", "train", "warm up", "run together"],
      ["cheer", "support", "watch together"],
      ["ice cream", "hang out", "celebrate", "photo together"],
    ],
    components: [
      {
        key: "salutation", label: "Salutation",
        options: [
          { id: "a", text: "Hi Wei Jie," },
          { id: "b", text: "Dear Sir/Madam," },
          { id: "c", text: "To whom it may concern," },
          { id: "d", text: "Dear Mr Wei Jie," },
        ],
      },
      {
        key: "purpose", label: "Purpose",
        options: [
          { id: "a", text: "I heard you missed the announcement about Sports Day, so I thought I'd fill you in and see if you want to join our house group!" },
          { id: "b", text: "I am writing to formally notify you of an upcoming event." },
          { id: "c", text: "I am writing to complain about missing you at school." },
          { id: "d", text: "This is to inform you that Sports Day has been cancelled." },
        ],
      },
      {
        key: "keyinfo1", label: "Key information — when & where",
        options: [
          { id: "a", text: "It's happening this Friday, 21 March, from 2 to 5pm at the School Field." },
          { id: "b", text: "It's happening sometime next year, not sure when." },
          { id: "c", text: "It got moved to another school entirely." },
          { id: "d", text: "It's actually just a normal PE lesson." },
        ],
      },
      {
        key: "keyinfo2", label: "Key information — what to bring",
        options: [
          { id: "a", text: "Don't forget to bring your water bottle and your house T-shirt!" },
          { id: "b", text: "You don't need to bring anything at all." },
          { id: "c", text: "You should bring your textbooks just in case." },
          { id: "d", text: "Bring an umbrella because it will definitely rain." },
        ],
      },
      {
        key: "filler", label: "Additional context",
        options: [
          { id: "a", text: "There's also a class photo right after the closing ceremony, so try not to be late!" },
          { id: "b", text: "Also, I heard the school canteen is closed forever." },
          { id: "c", text: "By the way, I'm changing schools next week." },
          { id: "d", text: "This has nothing to do with Sports Day but guess what happened yesterday." },
        ],
      },
      {
        key: "signoff", label: "Sign-off",
        options: [
          { id: "a", text: "See you there!" },
          { id: "b", text: "Yours faithfully," },
          { id: "c", text: "Yours sincerely," },
          { id: "d", text: "Regards, Management" },
        ],
      },
    ],
    answerKey: {
      components: { salutation: "a", purpose: "a", keyinfo1: "a", keyinfo2: "a", filler: "a", signoff: "a" },
      paragraphBreaks: ["purpose", "keyinfo1", "filler"],
    },
    model_letter:
      "Hi Wei Jie,\n\nI heard you missed the announcement about Sports Day, so I thought I'd fill you in and see if you want to join our house group! It's happening this Friday, 21 March, from 2 to 5pm at the School Field.\n\nDon't forget to bring your water bottle and your house T-shirt! There's also a class photo right after the closing ceremony, so try not to be late!\n\nSee you there!",
  },
];

// v1.6: normalise the built-in tutorial cases to the same 13-part Step 4
// structure used by teacher-created cases.
function demoOption(key, correct, d1, d2) {
  return { key, label: ({
    salutation: "Salutation (Audience)", greeting: "Greeting / Introduction", purpose: "Purpose", context: "Context",
    keyinfo1: "Key information 1", keyinfo2: "Key information 2", keyinfo3: "Key information 3", keyinfo4: "Key information 4", keyinfo5: "Key information 5",
    ownIdea: "Own idea", closing: "Closing sentence", signoff: "Sign-off", name: "Name"
  })[key], options: [{id:"a",text:correct},{id:"b",text:d1},{id:"c",text:d2}] };
}

function upgradeDemoCase(c) {
  const old = Object.fromEntries((c.components || []).map(x => [x.key, x]));
  const pts = (c.stimulusPoints || []).filter(x => x.relevant).map(x => x.text);
  const formal = !!c.formal;
  const opt = (key, fallback, d1, d2) => { const x = old[key]; return demoOption(key, x?.options?.find(o => o.id === "a")?.text || fallback, x?.options?.find(o => o.id === "b")?.text || d1, x?.options?.find(o => o.id === "c")?.text || d2); };
  c.components = [
    opt("salutation", formal ? "Dear Sir/Madam," : "Hi there,", "Dear friend,", "Hey everyone,"),
    opt("greeting", formal ? "I hope you are well.": "How are you? I hope you have been well.", formal ? "Hey! How's it going?" : "Dear Sir/Madam, I write regarding this matter.", "I hereby wish to inform you of the following."),
    opt("purpose", "I am writing to tell you about this situation.", "I am writing about an unrelated matter.", "I am writing to complain about the weather."),
    opt("context", "I thought I should explain the situation so you know what happened.", "This has nothing to do with the event.", "I have lots of homework tonight."),
    opt("keyinfo1", pts[0] || "The first important detail is included in the notice.", "The first detail is not needed.", "The first detail is completely different."),
    opt("keyinfo2", pts[1] || "The second important detail is included in the notice.", "The second detail is not needed.", "The second detail is completely different."),
    opt("keyinfo3", pts[2] || "The third important detail is included in the notice.", "The third detail is not needed.", "The third detail is completely different."),
    opt("keyinfo4", pts[3] || "The fourth important detail is included in the notice.", "The fourth detail is not needed.", "The fourth detail is completely different."),
    opt("keyinfo5", pts[4] || "The fifth important detail is included in the notice.", "The fifth detail is not needed.", "The fifth detail is completely different."),
    opt("ownIdea", (c.ownContentKeywords?.[0]?.[0]) || "suggest a helpful idea", "offer another practical way to help", "contribute in another suitable way"),
    opt("closing", formal ? "Thank you for considering my suggestion." : "Hope to hear from you soon!", "This is the end of an unrelated topic.", "I am not sure what else to say."),
    opt("signoff", formal ? "Yours sincerely," : "Best,", "Yours faithfully,", "Love and hugs forever,"),
    opt("name", formal ? "Wei Ming Tan" : "Wei Ming", formal ? "Wei Ming" : "Wei Ming Tan", "Mr Tan")
  ];
  c.answerKey = { components: Object.fromEntries(c.components.map(x => [x.key, "a"])), paragraphBreaks: c.answerKey?.paragraphBreaks || ["purpose", "keyinfo1", "closing", "signoff"] };
  return c;
}

for (const c of DEMO_CASES) upgradeDemoCase(c);

