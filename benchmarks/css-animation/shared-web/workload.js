import { seededRandom } from "../../../shared/protocols/config.mjs";
export function cssWorkload(stage) {
  let scrolling = 0,
    running = false;
  return {
    metadata() {
      return { workload_width: stage.clientWidth, workload_height: 360 };
    },
    async prepare({ nodes, caseName }, seed) {
      stage.replaceChildren();
      stage.className = `stage workload-${caseName}`;
      const random = seededRandom(seed),
        fragment = document.createDocumentFragment();
      for (let i = 0; i < nodes; i++) {
        const card = document.createElement("div");
        card.className = "stress-node";
        card.style.setProperty("--x", `${random() * 90}%`);
        card.style.setProperty("--y", `${random() * 85}%`);
        card.style.setProperty("--delay", `${-random() * 3}s`);
        card.style.setProperty("--duration", `${2 + random() * 2}s`);
        card.style.setProperty("--hue", `${90 + random() * 65}`);
        if (caseName === "nested-transform") {
          let parent = card;
          for (let depth = 0; depth < 7; depth++) {
            const child = document.createElement("div");
            child.className = "nested";
            parent.append(child);
            parent = child;
          }
        }
        if (caseName === "mixed") {
          card.classList.add("mixed-card");
          card.innerHTML = `<span class="card-dot"></span><span>Task ${String(i + 1).padStart(3, "0")}</span><small>render / active</small><i></i>`;
        }
        if (caseName === "scroll-animation")
          card.textContent = `Frame pipeline · ${String(i + 1).padStart(5, "0")}`;
        fragment.append(card);
      }
      stage.append(fragment);
      stage.dataset.nodeCount = nodes;
      if (caseName === "mixed") {
        const chrome = document.createElement("div");
        chrome.className = "mixed-chrome";
        chrome.innerHTML =
          '<aside>Workspace<br><br>Overview<br>Messages<br>Files</aside><div class="mixed-tabs">Overview　 /　 Editor　 /　 Activity</div><div class="mixed-editor">01　const runtime = await bench();<br>02　render(scene);<br>03　collect(metrics);</div><div class="mixed-glass">Rendering preview<br><button type="button">Continue</button></div><div class="mixed-toolbar">＋　 ↗　 ⚙</div>';
        stage.append(chrome);
      }
    },
    start() {
      running = true;
      stage.classList.add("running");
      if (stage.classList.contains("workload-scroll-animation")) {
        let origin;
        const tick = (t) => {
          if (!running) return;
          origin ??= t;
          stage.scrollTop =
            (0.5 + 0.5 * Math.sin((t - origin) / 3000)) *
            (stage.scrollHeight - stage.clientHeight);
          scrolling = requestAnimationFrame(tick);
        };
        scrolling = requestAnimationFrame(tick);
      }
    },
    stop() {
      running = false;
      cancelAnimationFrame(scrolling);
      stage.classList.remove("running");
    },
    dispose() {
      this.stop();
      stage.replaceChildren();
      stage.className = "stage";
    },
  };
}
