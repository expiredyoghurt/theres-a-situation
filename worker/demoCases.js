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

const GARDEN_OPEN_HOUSE_SVG = `
<svg viewBox="0 0 640 420" xmlns="http://www.w3.org/2000/svg" font-family="Trebuchet MS, Verdana, sans-serif">
  <rect width="640" height="420" fill="#EAF4DC"/>
  <rect x="14" y="14" width="612" height="392" fill="none" stroke="#3E7A2E" stroke-width="4" rx="12"/>
  <text x="320" y="72" text-anchor="middle" font-size="30" font-weight="bold" fill="#2B5A1E">GARDEN CLUB OPEN HOUSE</text>
  <text x="320" y="98" text-anchor="middle" font-size="14" fill="#4A6B3A" font-style="italic">Riverbank Primary School</text>
  <g transform="translate(320,160)">
    <path d="M0 40 V-5" stroke="#3E7A2E" stroke-width="5" fill="none"/>
    <path d="M0 10 C-35 10 -42 -25 -38 -34 C-8 -34 0 -8 0 10 Z" fill="#7FBF5A" stroke="#3E7A2E" stroke-width="2"/>
    <path d="M0 -5 C35 -5 42 -40 38 -49 C8 -49 0 -23 0 -5 Z" fill="#9AD16F" stroke="#3E7A2E" stroke-width="2"/>
    <path d="M-30 40 h60 l-8 22 h-44 z" fill="#C97B3C" stroke="#8A4F1F" stroke-width="2"/>
  </g>
  <g font-size="15" fill="#25451A">
    <text x="90" y="258">&#8226; Date: Wednesday, 18 March, 2pm &#8211; 4pm</text>
    <text x="90" y="283">&#8226; Venue: Rooftop Garden (Level 5)</text>
    <text x="90" y="308">&#8226; Plant your own seedling &amp; taste fresh herbs from the garden</text>
    <text x="90" y="333">&#8226; Bring a recycled pot or container to take your seedling home</text>
    <text x="90" y="358">&#8226; Register with Ms Lim (Staff Room) by 11 March</text>
  </g>
  <text x="535" y="395" font-size="11" fill="#4A6B3A" text-anchor="middle">Winner, Green School Award 2024</text>
  <text x="130" y="395" font-size="11" fill="#4A6B3A" text-anchor="middle">Free lemongrass tea for 40 visitors</text>
</svg>`.trim();

// ---------------------------------------------------------------------------
// v1.14: both tutorial cases are written out in full as the standard 13-part
// Step 4 structure. Every wrong option is a REALISTIC slip a Primary 6 pupil
// could actually make (wrong date, wrong register, mismatched sign-off,
// vague or illogical idea) — never an obviously silly line — because the
// wrong options are where the learning happens.
// ---------------------------------------------------------------------------

const LABELS = {
  salutation: "Salutation (Audience)", greeting: "Greeting / Introduction", purpose: "Purpose", context: "Context",
  keyinfo1: "Key information 1", keyinfo2: "Key information 2", keyinfo3: "Key information 3", keyinfo4: "Key information 4", keyinfo5: "Key information 5",
  ownIdea: "Own idea", closing: "Closing sentence", signoff: "Sign-off", name: "Name",
};
const ORDER = ["salutation", "greeting", "purpose", "context", "keyinfo1", "keyinfo2", "keyinfo3", "keyinfo4", "keyinfo5", "ownIdea", "closing", "signoff", "name"];

// v1.15: the article's 13 parts (same count as a letter, different parts).
const ARTICLE_LABELS = {
  headline: "Headline", byline: "Byline (your full name)", hook: "Opening hook", purpose: "Purpose", context: "Context",
  keyinfo1: "Key information 1", keyinfo2: "Key information 2", keyinfo3: "Key information 3", keyinfo4: "Key information 4", keyinfo5: "Key information 5",
  ownIdea: "Own idea", cta: "Call to action", thanks: "Thanks to readers",
};
const ARTICLE_ORDER = ["headline", "byline", "hook", "purpose", "context", "keyinfo1", "keyinfo2", "keyinfo3", "keyinfo4", "keyinfo5", "ownIdea", "cta", "thanks"];

/** parts: { key: [correct, wrongA, wrongB] }  — stored ids: "a" is always the correct one (the client sees opaque, shuffled ids). */
function buildComponents(parts, order = ORDER, labels = LABELS) {
  return order.map((key) => ({
    key, label: labels[key],
    options: ["a", "b", "c"].map((id, i) => ({ id, text: parts[key][i] })),
  }));
}

/** Join the correct options the same way the Worker's assembleLetter() does. */
function modelLetterFrom(parts, breaks, order = ORDER, article = false) {
  let out = "", prev = "";
  for (const key of order) {
    const text = parts[key][0];
    if (out) {
      if (breaks.includes(key)) out += "\n\n";
      else if (article ? (prev === "headline" || prev === "byline" || key === "byline") : (prev === "salutation" || key === "signoff" || key === "name")) out += "\n";
      else out += " ";
    }
    out += text;
    prev = key;
  }
  return out;
}

const BREAKS = ["greeting", "keyinfo1", "ownIdea", "closing", "signoff"];

const PARTS_1 = {
  salutation: ["Dear Mr Kumar,", "Dear Sir/Madam,", "Hi Mr Kumar,"],
  greeting: ["I hope this email finds you well.", "Hope you are doing great!", "I trust that this email will reach you promptly."],
  purpose: [
    "I am writing to inform you that I am unable to attend the Recycling Fair on Saturday, 14 March, and to suggest another way I can help.",
    "I am writing to ask whether the Recycling Fair can be moved to a day that suits me better.",
    "I am writing to tell you that I cannot come to the Recycling Fair, so please find someone else.",
  ],
  context: [
    "Unfortunately, I have a prior family commitment on that day and will not be able to volunteer.",
    "Unfortunately, I do not think the Fair is very important, so I have made other plans.",
    "Unfortunately, I will be attending another school's fair on that day.",
  ],
  keyinfo1: [
    "I understand that the Fair will be held on Saturday, 14 March, from 9am to 12pm.",
    "I understand that the Fair will be held on Saturday, 16 March, from 9am to 12pm.",
    "I understand that the Fair will be held on a Saturday morning in March, but I did not note the exact date.",
  ],
  keyinfo2: [
    "I also know that it will take place at the School Hall.",
    "I also know that it will take place at the School Field.",
    "I also know that it will take place somewhere in the school, but I am not sure where.",
  ],
  keyinfo3: [
    "Volunteers are needed to man the booths and sort recyclables during the Fair.",
    "Volunteers are needed to cook food and serve drinks at the booths during the Fair.",
    "Volunteers are needed to help in some way during the Fair, although I am not sure how.",
  ],
  keyinfo4: [
    "I understand that pupils who wish to volunteer must sign up with you by 7 March.",
    "I understand that pupils who wish to volunteer must sign up with you by 17 March.",
    "I understand that pupils who wish to volunteer must sign up with you before the end of the term.",
  ],
  keyinfo5: [
    "I am sorry that I cannot man a booth together with the other volunteers on the day.",
    "I am not sorry at all, since the Fair does not interest me very much.",
    "I am sorry, and I may still come on the day if my plans change, even though I said I cannot.",
  ],
  ownIdea: [
    "Since I cannot be there, I would like to design publicity posters before 7 March so that more pupils know about the Fair.",
    "Since I cannot be there, I could help by coming to the Fair for the last half hour to sort recyclables.",
    "Since I cannot be there, I could help by serving the free popcorn to the visitors on the day.",
  ],
  closing: [
    "Thank you for considering my suggestion, and I apologise for any inconvenience caused.",
    "Please reply as soon as possible, because I need your answer today.",
    "That is all I wanted to say, so goodbye.",
  ],
  signoff: ["Yours sincerely,", "Yours faithfully,", "Cheers,"],
  name: ["Wei Ming Tan", "Wei Ming", "A concerned pupil"],
};

const PARTS_2 = {
  salutation: ["Hi Wei Jie,", "Dear Sir/Madam,", "Dear Mr Wei Jie,"],
  greeting: ["How are you? I hope you have been well!", "I am writing to extend my warmest greetings to you.", "Hey!!! Long time no see!!!"],
  purpose: [
    "I heard you missed the announcement about Sports Day, so I thought I would fill you in and invite you to join our house group!",
    "I am writing to formally notify you of an upcoming school event.",
    "I am writing to tell you that Sports Day has been cancelled.",
  ],
  context: [
    "I saw the notice on the school board yesterday, and it sounds like it will be a great day.",
    "I saw the notice, but I think you should ignore it because it is not important.",
    "I saw the notice and told everyone else about it, but not you.",
  ],
  keyinfo1: [
    "It will be held on Friday, 21 March, from 2pm to 5pm.",
    "It will be held on Friday, 28 March, from 2pm to 5pm.",
    "It will be held on a Friday afternoon, but I forgot which one.",
  ],
  keyinfo2: [
    "It will take place at the School Field.",
    "It will take place at the School Hall.",
    "It will take place at school, but I am not sure where.",
  ],
  keyinfo3: [
    "Remember to bring your water bottle and your house T-shirt.",
    "Remember to bring your school bag and your PE shoes.",
    "Remember to bring something to drink and wear something comfortable.",
  ],
  keyinfo4: [
    "There will also be a class photo right after the closing ceremony, so please do not leave early!",
    "There will also be a class photo right before the opening ceremony, so please come early!",
    "There will also be a class photo at some point during the event, I think.",
  ],
  keyinfo5: [
    "I would really love for you to join our house group and cheer with us!",
    "You must join our house group, otherwise you might get into trouble.",
    "You can join any house group you like; it does not matter to me.",
  ],
  ownIdea: [
    "To warm up for the day, we could practise running together at the field after school on Wednesday.",
    "We could skip Sports Day and go to the mall together instead.",
    "I could run your races for you so that you can stay at home.",
  ],
  closing: [
    "Let me know if you would like to join, and I will save a spot for you!",
    "Tell me right now, or I will find someone else.",
    "Whatever you decide is fine, I guess, bye.",
  ],
  signoff: ["Best wishes,", "Yours faithfully,", "Yours truly, The Management"],
  name: ["Wei Ming", "Mr Tan Wei Ming", "Your classmate from 5IG"],
};

// v1.15 tutorial ARTICLE (no salutation / sign-off). Same realistic-slip rule for the wrong options.
const BREAKS_ARTICLE = ["hook", "keyinfo1", "cta"];
const PARTS_3 = {
  headline: ["Come and Grow with Us at the Garden Club Open House!", "Garden Club Open House Details.", "A Very Long Notice About Something That Is Happening At School Soon"],
  byline: ["By Wei Ming Tan", "By Wei Ming", "By A Member Of The Garden Club"],
  hook: [
    "Have you ever wondered how the herbs and vegetables on your plate begin their journey?",
    "The Garden Club is having an Open House.",
    "Gardening may sound boring, but you should still read this.",
  ],
  purpose: [
    "I am excited to share the details of our Garden Club Open House and to invite every one of you to take part.",
    "I am writing to complain that not enough pupils know about the Garden Club.",
    "I want to talk about the garden, the school and a few other things.",
  ],
  context: [
    "As a proud member of the Garden Club, I have spent many afternoons preparing the Rooftop Garden for this special event.",
    "As a member of the Library Club, I have spent many afternoons preparing the library for a special event.",
    "I have been busy with my homework, so I only have a little to say about it.",
  ],
  keyinfo1: [
    "The Open House will be held on Wednesday, 18 March, from 2pm to 4pm.",
    "The Open House will be held on Wednesday, 19 March, from 2pm to 4pm.",
    "The Open House will be held on a Wednesday afternoon in March, but I did not note the exact date.",
  ],
  keyinfo2: [
    "Furthermore, it will take place at the Rooftop Garden on Level 5.",
    "Furthermore, it will take place at the School Hall on Level 1.",
    "Furthermore, it will take place somewhere in the school building.",
  ],
  keyinfo3: [
    "Visitors can plant their very own seedling and taste fresh herbs picked from our garden.",
    "Visitors can water the plants and buy fresh vegetables grown by our members.",
    "Visitors can try a few gardening activities, although I am not sure which ones.",
  ],
  keyinfo4: [
    "Moreover, please remember to bring a recycled pot or container so that you can take your seedling home.",
    "Moreover, please remember to buy a brand new pot from the shop so that you can take your seedling home.",
    "Moreover, please bring something to carry your seedling in, whatever you can find.",
  ],
  keyinfo5: [
    "To take part, simply register with Ms Lim in the Staff Room by 11 March.",
    "To take part, simply register with Ms Tan in the Staff Room by 11 March.",
    "To take part, simply register with a teacher before the event.",
  ],
  ownIdea: [
    "After taking your seedling home, you can set a daily phone reminder to water it so that it grows tall and strong.",
    "After taking your seedling home, you can keep it in a dark cupboard so that it stays safe.",
    "After taking your seedling home, you can plant a tree on the school field instead.",
  ],
  cta: [
    "So why not join us at the Rooftop Garden and register with Ms Lim today?",
    "I hope many of you will feel like coming along someday.",
    "You must register today or you will be sorry.",
  ],
  thanks: [
    "Thank you for reading, and I hope to see you there!",
    "That is all, bye.",
    "Thx 4 reading, c u there!",
  ],
};

export const DEMO_CASES = [
  {
    id: "demo-1",
    title: "Case #1 — The Recycling Fair (Tutorial)",
    format: "formal_letter",
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
    hunchHint: "You cannot attend on the day — so what could you do BEFORE the Fair? Look at the sign-up deadline in the notice.",
    ownContentKeywords: [
      ["donate", "contribute items", "give recyclables", "bring recyclable items"],
      ["poster", "posters", "banner", "design", "publicity"],
      ["help before", "prepare", "pack", "set up", "sort at home", "sort in advance"],
      ["social media", "promote", "spread the word", "announce", "advertise"],
    ],
    components: buildComponents(PARTS_1),
    answerKey: { components: Object.fromEntries(ORDER.map((k) => [k, "a"])), paragraphBreaks: BREAKS },
    model_letter: modelLetterFrom(PARTS_1, BREAKS),
  },
  {
    id: "demo-2",
    title: "Case #2 — Sports Day Mix-up (Tutorial)",
    format: "informal_letter",
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
    hunchHint: "Think about getting ready for the races together, or celebrating afterwards.",
    ownContentKeywords: [
      ["practice", "practise", "train", "warm up", "run together"],
      ["cheer", "support", "watch together"],
      ["ice cream", "hang out", "celebrate", "photo together"],
    ],
    components: buildComponents(PARTS_2),
    answerKey: { components: Object.fromEntries(ORDER.map((k) => [k, "a"])), paragraphBreaks: BREAKS },
    model_letter: modelLetterFrom(PARTS_2, BREAKS),
  },
  {
    id: "demo-3",
    title: "Case #3 — Garden Club Open House (Article Tutorial)",
    format: "article",
    formal: false,
    imageData: svgDataUrl(GARDEN_OPEN_HOUSE_SVG),
    taskText:
      "You are a member of your school's Garden Club and you saw this notice about the Garden Club Open House. Write an article for the school newsletter to encourage your schoolmates to come. Include these details (a) the date and time of the open house, (b) venue, (c) what you can do there, (d) what you should bring along, (e) how to register for the open house, and include one idea of your own on how pupils can keep their seedlings healthy at home.",
    taskChunks: [
      { id: "c1", text: "You are a member of your school's Garden Club and you saw this notice about the Garden Club Open House.", type: "context" },
      { id: "c2", text: "Write an article for the school newsletter", type: "audience" },
      { id: "c3", text: "to encourage your schoolmates to come.", type: "purpose" },
      { id: "c4", text: "Use the notice for details,", type: "other" },
      { id: "c5", text: "and include one idea of your own on how pupils can keep their seedlings healthy at home.", type: "other" },
    ],
    stimulusPoints: [
      { id: "s1", text: "Date: Wednesday, 18 March, 2pm to 4pm", relevant: true },
      { id: "s2", text: "Venue: Rooftop Garden, Level 5", relevant: true },
      { id: "s3", text: "Plant your own seedling and taste fresh herbs", relevant: true },
      { id: "s4", text: "Bring a recycled pot or container to take the seedling home", relevant: true },
      { id: "s5", text: "Register with Ms Lim by 11 March", relevant: true },
      { id: "s6", text: "The Garden Club won the Green School Award 2024", relevant: false },
      { id: "s7", text: "Free lemongrass tea for the first 40 visitors", relevant: false },
    ],
    ownContentPrompt:
      "Suggest ONE idea on how pupils can keep their seedlings healthy once they have taken them home in a recycled pot.",
    hunchHint: "The notice says pupils take the seedling home in a recycled pot. What does a young plant need every day?",
    ownContentKeywords: [
      ["water", "watering", "reminder", "alarm", "daily"],
      ["sunlight", "sunny", "window", "balcony", "sun"],
      ["journal", "record", "photo", "track growth", "diary"],
      ["fertiliser", "fertilizer", "compost", "rice water", "tea leaves"],
    ],
    components: buildComponents(PARTS_3, ARTICLE_ORDER, ARTICLE_LABELS),
    answerKey: { components: Object.fromEntries(ARTICLE_ORDER.map((k) => [k, "a"])), paragraphBreaks: BREAKS_ARTICLE },
    model_letter: modelLetterFrom(PARTS_3, BREAKS_ARTICLE, ARTICLE_ORDER, true),
  },
];
