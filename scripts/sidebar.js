let taxonomyData = null;
let samplesData = null;
let iconsData = null;

async function loadTaxonomyTree(taxData, samples, icons) {
  if (taxonomyData === null) taxonomyData = taxData;
  if (samplesData === null) samplesData = samples;
  if (iconsData === null) iconsData = icons;
  if (taxonomyData === null || samplesData === null || iconsData === null) return;

  const container = document.getElementById("tree-container");
  container.innerHTML = ""; // avoid duplicates if called again

  function sampleCountForTaxonKey(key) {
    return Object.keys(samplesData).filter((sampleId) => {
      const sample = samplesData[sampleId];
      const lt = sample.lowest_taxa;
      return Array.isArray(lt) ? lt.includes(key) : lt === key;
    }).length;
  }

  // Root of the drawer's links. documentHref keeps the whole tree inside the language
  // being read, so opening the drawer on a Greek page does not walk you into English.
  const treeRoot = documentHref("tree");

  function buildTree(node, taxonPath = "") {
    const ul = document.createElement("ul");

    for (const [key, value] of Object.entries(node.subtaxa || {})) {
      const hasChildren = !!(value && value.subtaxa && Object.keys(value.subtaxa).length);
      const count = sampleCountForTaxonKey(key);

      const li = document.createElement("li");
      li.classList.add("tree-item");
      if (hasChildren) li.classList.add("has-children");
      // default collapse logic
      // 1. if in the parent path of the current page, expand
      const currentPath = window.location.href;
      if (currentPath.startsWith(taxonPath + `/${key}/`)) {
        // part of the current path, expand
      } else if (taxonPath != treeRoot) {
        // else expand top-level nodes only
        li.classList.add("is-collapsed"); // default to collapsed
      }

      // The toggle and the link share a row of their own. As inline siblings of
      // the child list they were laid out on a text line, so a label long enough
      // to wrap — routine for a Greek binomial in a 300px drawer — dragged the
      // icon down to the middle of two lines while the connector stayed on the
      // first, and the elbow visibly came away from the node. A flex row aligned
      // to its top keeps the icon on the first line whatever the label does.
      const row = document.createElement("div");
      row.className = "tree-row";
      li.appendChild(row);

      // toggle button (only for nodes with children)
      let toggleBtn = null;
      if (hasChildren) {
        toggleBtn = document.createElement("button");
        toggleBtn.type = "button";
        toggleBtn.className = "tree-toggle";
        toggleBtn.setAttribute("aria-label", "Expand/collapse");
        toggleBtn.setAttribute("aria-expanded", "true");
        row.appendChild(toggleBtn);
      } else {
        // spacer to align nodes that do not have a toggle
        const spacer = document.createElement("span");
        spacer.className = "tree-toggle-spacer";
        row.appendChild(spacer);
      }

      // link
      const a = document.createElement("a");
      a.dataset.icon = getBaseURL() + `/images/thumbnails/thumbs_dir/${capitalize(value.name.el)}_thumb.webp`;
      a.href = `${taxonPath}/${key}/${key}.html`;
      a.id = `tree-node-${key}`;
      a.className = "tree-node";
      if (a.pathname.replace(/\.html$/, "") === window.location.pathname.replace(/\.html$/, "")) {
        a.setAttribute("aria-current", "page");
      }
      a.dataset.sampleCount = count;
      if (value.extinct) a.dataset.extinct = '1';

      // circular phylopic icon node
      const iconSpan = document.createElement("span");
      iconSpan.className = "node-icon";
      const phylopicUrl = iconsData[key];
      if (phylopicUrl) iconSpan.style.backgroundImage = `url("${phylopicUrl}")`;
      else iconSpan.classList.add("no-icon");
      a.appendChild(iconSpan);

      // label (kept in its own span so the translator never clobbers the icon)
      const labelSpan = document.createElement("span");
      labelSpan.className = "node-label";
      labelSpan.textContent = (value.extinct ? "†" : "") + (value.name?.en || key);
      a.appendChild(labelSpan);

      // sample-count badge
      const countSpan = document.createElement("span");
      countSpan.className = "node-count";
      if (count) countSpan.textContent = String(count);
      else countSpan.style.display = "none";
      a.appendChild(countSpan);

      row.appendChild(a);

      // children (wrapped for a grid-based slide-down animation)
      if (hasChildren) {
        const childUl = buildTree(value, `${taxonPath}/${key}`);
        childUl.classList.add("tree-children");
        const wrap = document.createElement("div");
        wrap.className = "tree-children-wrap";
        wrap.appendChild(childUl);
        li.appendChild(wrap);
      }

      ul.appendChild(li);
    }

    return ul;
  }

  container.appendChild(buildTree({ subtaxa: taxonomyData }, treeRoot));

  // The tree is built lazily (on first sidebar open), after applyLanguage() already ran
  // on page load, so translate the freshly-built labels to the active language now.
  // Otherwise they'd stay lowercase English until the user manually switches language.
  updateSidebarTree(getLanguage());

  // Event delegation for toggles
  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".tree-toggle");
    if (!btn) return;

    const li = btn.closest("li");
    const childWrap = li.querySelector(":scope > .tree-children-wrap");
    if (!childWrap) return;

    const isCollapsed = li.classList.toggle("is-collapsed");
    btn.setAttribute("aria-expanded", String(!isCollapsed));
  });
}


document.addEventListener('mouseover', function (e) {
  const node = e.target.closest('.tree-node');
  if (!node) return;

  const iconUrl = node.dataset.icon;
  if (!iconUrl) return;

  // avoid stacking previews when moving across the node's child spans
  document.querySelectorAll('.hover-icon-preview').forEach(el => el.remove());

  // Phones have no hover; a tap would leave the preview stuck over the drawer.
  if (!window.matchMedia('(hover: hover)').matches) return;

  const img = document.createElement('img');
  const imgsize = 120;  // matches .hover-icon-preview in style.css
  img.src = iconUrl;
  img.alt = '';
  img.classList.add('hover-icon-preview');

  // Get viewport dimensions
  const padding = 10;
  const { clientX, clientY } = e;
  const maxX = window.innerWidth - imgsize - padding;
  const maxY = window.innerHeight - imgsize - padding;

  img.style.left = `${Math.min(clientX + 10, maxX)}px`;
  img.style.top = `${Math.min(clientY + 10, maxY)}px`;

  document.body.appendChild(img);

  node.addEventListener('mouseleave', () => {
    document.querySelectorAll('.hover-icon-preview').forEach(el => el.remove());
  }, { once: true });
});


// The drawer is a full-height sheet laid out by style.css; this only opens and
// closes it, locks the page behind it and hands focus back where it came from.
let sidebarReturnFocus = null;

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (sidebar.classList.contains('collapsed')) openSidebar();
  else closeSidebar();
}

function openSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebarReturnFocus = document.activeElement;
  sidebar.classList.remove('collapsed');
  document.getElementById('sidebar-overlay').classList.remove('hidden');
  document.documentElement.classList.add('drawer-open');
  ensureTreeLoaded();
  const close = sidebar.querySelector('.drawer-close');
  if (close) close.focus({ preventScroll: true });
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (sidebar.classList.contains('collapsed')) return;
  sidebar.classList.add('collapsed');
  document.getElementById('sidebar-overlay').classList.add('hidden');
  document.documentElement.classList.remove('drawer-open');
  if (sidebarReturnFocus && sidebarReturnFocus.focus) sidebarReturnFocus.focus({ preventScroll: true });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSidebar();
});

// The Tree-of-Life data (taxonomy.json + samples_info.json ≈ 1.16 MB) is only needed
// once the sidebar is opened, so fetch it lazily on first open instead of on every
// page load. Guarded so it runs at most once.
let treeLoadStarted = false;
function ensureTreeLoaded() {
  if (treeLoadStarted) return;
  treeLoadStarted = true;
  fetch(getBaseURL() + '/jsondata/taxonomy.json')
    .then((resp) => resp.json())
    .then(json => loadTaxonomyTree(json, null, null));
  fetch(getBaseURL() + '/jsondata/samples_info.json')
    .then((resp) => resp.json())
    .then(json => loadTaxonomyTree(null, json, null));
  fetchJSONCached(getBaseURL() + '/jsondata/taxa_icons.json')
    .then(json => loadTaxonomyTree(null, null, json))
    .catch(() => loadTaxonomyTree(null, null, {}));
}

// ---- Palette ----------------------------------------------------------------
// Dark is the default: the photographs are lit for it. Light is asked for from
// the menu, remembered under `theme` and applied before first paint (head_lang.html).
(function () {
  // One control in the header, one in the drawer; both drive the same palette.
  const buttons = document.querySelectorAll('[data-theme-toggle]');
  if (!buttons.length) return;

  const render = (dark) => {
    buttons.forEach((button) => {
      button.setAttribute('aria-pressed', dark ? 'true' : 'false');
      // The button names the palette you would switch to, not the one you are in.
      const name = dark ? button.dataset.labelLight : button.dataset.labelDark;
      const label = button.querySelector('[data-theme-label]');
      if (label) label.textContent = name;
      else { button.setAttribute('aria-label', name); button.title = name; }
    });
  };

  let dark = true;
  try {
    dark = localStorage.getItem('theme') !== 'light';
  } catch (e) {
    // Private browsing, or storage disabled: the toggle still works for this
    // page load, it just will not be remembered.
  }
  render(dark);

  buttons.forEach((button) => button.addEventListener('click', () => {
    dark = !dark;
    if (dark) delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = 'light';
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    } catch (e) { /* not remembered; see above */ }
    render(dark);
  }));
})();
