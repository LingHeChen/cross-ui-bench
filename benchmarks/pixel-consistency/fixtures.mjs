import { writeFile, mkdir } from "node:fs/promises";
import { makeTexture } from "../../tools/asset-generator/stress.mjs";
const names = [
  "Dashboard",
  "Chat",
  "Code Editor",
  "Settings",
  "Media Player",
  "Complex Modal",
];
const box = (id, x, y, width, height, extra = {}) => ({
  id,
  x,
  y,
  width,
  height,
  ...extra,
});
export function pixelFixtures() {
  return names.map((name, index) => {
    const body = box("content", 280, 136, 940, 596, {
      type: "container",
      color: "#ffffff",
      radius: 12,
      border: "#d7ddd5",
      children: [],
    });
    const nodes = [
      box("sidebar", 24, 24, 224, 752, {
        type: "container",
        color: "#193a2c",
        radius: 16,
        children: [
          box("brand", 20, 26, 180, 32, {
            type: "text",
            text: "CROSSUI / LAB",
            fontSize: 20,
            color: "#ecf6e9",
          }),
          ...[
            "Overview",
            "Messages",
            "Editor",
            "Settings",
            "Media",
            "Reports",
          ].map((t, i) =>
            box("nav-" + i, 20, 102 + i * 54, 180, 34, {
              type: "text",
              text: t,
              fontSize: 16,
              color: "#ecf6e9",
            }),
          ),
        ],
      }),
      box("title", 280, 34, 860, 50, {
        type: "text",
        text: name,
        fontSize: 32,
        color: "#193a2c",
      }),
      box("subtitle", 280, 94, 860, 25, {
        type: "text",
        text: "Fixed fixture / 1280 x 800 / IBM Plex / English / Light",
        fontSize: 14,
        color: "#68756a",
      }),
      body,
    ];
    const add = (n) => body.children.push(n);
    add(box("icon", 28, 28, 32, 32, { type: "icon", color: "#193a2c" }));
    add(
      box("section", 76, 30, 700, 28, {
        type: "text",
        text: [
          "Activity overview",
          "Team conversation",
          "Source workspace",
          "Display preferences",
          "Now playing",
          "Publish review",
        ][index],
        fontSize: 20,
        color: "#193a2c",
      }),
    );
    if (index === 0) {
      for (let i = 0; i < 3; i++)
        add(
          box("stat-" + i, 28 + i * 300, 88, 280, 120, {
            type: "container",
            color: i === 1 ? "#e6f3d5" : "#f1f4ef",
            radius: 8,
            children: [
              box("label-" + i, 18, 18, 220, 20, {
                type: "text",
                text: ["Frames sampled", "Median FPS", "Complete runs"][i],
                fontSize: 14,
              }),
              box("value-" + i, 18, 54, 220, 42, {
                type: "text",
                text: ["9,000", "60.00", "5 / 5"][i],
                fontSize: 30,
              }),
            ],
          }),
        );
    }
    if (index === 1) {
      for (let i = 0; i < 5; i++)
        add(
          box("message-" + i, 28 + (i % 2) * 180, 88 + i * 64, 650, 48, {
            type: "container",
            color: i % 2 ? "#e6f3d5" : "#f1f4ef",
            radius: 8,
            children: [
              box("message-text-" + i, 14, 12, 620, 24, {
                type: "text",
                text: [
                  "Hello, the fixture is ready.",
                  "Keep all runtimes at the same size.",
                  "The font is bundled locally.",
                  "Compare layout before pixels.",
                  "Captured at a fixed state.",
                ][i],
                fontSize: 16,
              }),
            ],
          }),
        );
    }
    if (index === 2)
      add(
        box("editor", 28, 88, 884, 350, {
          type: "container",
          color: "#193a2c",
          radius: 8,
          children: Array.from({ length: 10 }, (_, i) =>
            box("code-" + i, 18, 16 + i * 29, 840, 25, {
              type: "text",
              mono: true,
              text: `${String(i + 1).padStart(2, "0")}  ${["const runtime = await createBench();", 'const scene = loadFixture("editor");', "await fonts.ready;", "render(scene);", "const metrics = sampleFrames();"][i % 5]}`,
              fontSize: 16,
              color: "#e6f3d5",
            }),
          ),
        }),
      );
    if (index === 3) {
      for (let i = 0; i < 4; i++)
        add(
          box("setting-" + i, 28, 88 + i * 70, 884, 54, {
            type: "container",
            color: "#f1f4ef",
            radius: 8,
            children: [
              box("setting-label-" + i, 18, 16, 530, 24, {
                type: "text",
                text: [
                  "Theme: Light",
                  "Language: English",
                  "Scale: 100%",
                  "Motion state: Final frame",
                ][i],
                fontSize: 16,
              }),
              box("setting-button-" + i, 690, 10, 168, 34, {
                type: "button",
                text: "Configure",
                color: "#e6f3d5",
                fontSize: 14,
              }),
            ],
          }),
        );
    }
    if (index === 4) {
      add(box("cover", 28, 88, 350, 350, { type: "image" }));
      add(
        box("track", 410, 110, 440, 42, {
          type: "text",
          text: "A quiet afternoon",
          fontSize: 28,
        }),
      );
      add(
        box("artist", 410, 164, 440, 28, {
          type: "text",
          text: "CrossUI audio fixture",
          fontSize: 16,
        }),
      );
      add(box("progress", 410, 220, 440, 18, { type: "gradient", radius: 9 }));
      add(
        box("play", 410, 270, 140, 48, {
          type: "button",
          text: "Play",
          fontSize: 16,
          color: "#e6f3d5",
        }),
      );
    }
    if (index === 5) {
      add(box("backdrop", 28, 88, 884, 360, { type: "gradient", radius: 10 }));
      add(
        box("modal", 210, 116, 520, 280, {
          type: "blur",
          radius: 14,
          color: "#ffffffcc",
          shadow: true,
          children: [
            box("modal-title", 24, 26, 470, 36, {
              type: "text",
              text: "Ready to publish?",
              fontSize: 26,
            }),
            box("modal-body", 24, 92, 470, 66, {
              type: "text",
              text: "This fixture includes nested layout, text, blur and shadow.",
              fontSize: 16,
            }),
            box("modal-submit", 24, 202, 180, 42, {
              type: "button",
              text: "Confirm",
              fontSize: 16,
              color: "#e6f3d5",
            }),
          ],
        }),
      );
    }
    if (index !== 4 && index !== 5)
      add(
        box("visual-strip", 28, 470, 884, 44, { type: "gradient", radius: 8 }),
      );
    add(
      box("input", 28, 538, 656, 36, {
        type: "input",
        text: "Type a message...",
        fontSize: 14,
        color: "#f1f4ef",
      }),
    );
    add(
      box("submit", 708, 538, 204, 36, {
        type: "button",
        text: "Save fixture",
        fontSize: 14,
        color: "#193a2c",
        textColor: "#ffffff",
      }),
    );
    return {
      id:
        String(index + 1).padStart(2, "0") +
        "-" +
        name.toLowerCase().replaceAll(" ", "-"),
      name,
      width: 1280,
      height: 800,
      background: "#f6f7f2",
      nodes,
    };
  });
}
await mkdir("assets/pixel", { recursive: true });
await writeFile(
  "assets/pixel/fixtures.json",
  JSON.stringify(pixelFixtures(), null, 2),
);
await writeFile(
  "assets/pixel/image.png",
  makeTexture(256, 20261007, "baseColor"),
);
