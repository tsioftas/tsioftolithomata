/*
 * Explore page (formerly /map.html).
 *
 * Provides a filterable map + geological timeline view of the collection.
 * Two views (Leaflet map + SVG timeline) update together based on shared filters:
 *   - countries (pill selection)
 *   - taxa (major-group pills + autocomplete search)
 *   - time window (drag handles on the timeline)
 *
 * Non-matching localities stay visible but faded.
 * Map auto-fits to matching localities on every filter change.
 *
 * Data is provided by the server via the inline globals:
 *   window.LOCALITIES, window.TAXA_INDEX, window.MAJOR_TAXA,
 *   window.ICS_PERIODS, window.COUNTRIES, window.ROOT_PREFIX.
 */
(function () {
    "use strict";

    const SVG_NS = "http://www.w3.org/2000/svg";

    const filterState = {
        countries: new Set(),
        taxa: new Set(),
        ageFrom: null, // older boundary (Ma, larger number)
        ageTo: null,   // newer boundary (Ma, smaller number)
    };

    // ISO country code → flag emoji. For sub-national flags (en/sc) we use the
    // ISO 3166-2 GB-ENG / GB-SCT subdivision emoji which most modern systems render.
    const COUNTRY_FLAGS = {
        cy: "🇨🇾",
        ma: "🇲🇦",
        en: "🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}",
        sc: "🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}",
        unknown: "🏳",
    };

    // Major-taxon → icon (emoji). User-suggested replacements (e.g. SVGs from
    // PhyloPic) can swap these out later without touching the rest of the page.
    const TAXON_ICONS = {
        chordata: "🐟",
        dinosauria: "🦖",
        mollusca: "🐚",
        arthropoda: "🦀",
        echinodermata: "🌟",
        cnidaria: "🪼",
        plantae: "🌿",
        bacteria: "🦠",
    };

    // Epoch → enclosing geological period. Localities in this collection sometimes
    // record the epoch (miocene, pliocene, eocene) rather than the period name —
    // we map them up so the marker color uses the correct ICS band.
    const EPOCH_TO_PERIOD = {
        holocene: "quaternary",
        pleistocene: "quaternary",
        pliocene: "neogene",
        miocene: "neogene",
        oligocene: "paleogene",
        eocene: "paleogene",
        paleocene: "paleogene",
    };

    /* ------- Helpers ------- */

    function getCurrentLang() {
        return localStorage.getItem("language") || "en";
    }

    function tr(lang, key, fallback) {
        const gd = (typeof globalDict !== "undefined") ? globalDict : null;
        const dict = gd && gd[lang];
        if (dict && key in dict) return dict[key];
        return fallback != null ? fallback : key;
    }

    function localizedName(nameObj, lang) {
        if (!nameObj) return "";
        return nameObj[lang] || nameObj.en || Object.values(nameObj)[0] || "";
    }

    function capitalize(s) {
        if (!s) return "";
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    // Build a fast lookup: taxon key -> entry from TAXA_INDEX.
    const taxaByKey = {};
    for (const t of window.TAXA_INDEX) {
        taxaByKey[t.key] = t;
    }

    // Map ICS period key -> period info.
    const periodsByKey = {};
    for (const p of window.ICS_PERIODS) {
        periodsByKey[p.key] = p;
    }

    /* ------- Locality age helpers ------- */

    // Return [olderMa, newerMa] for a locality, or null if no age info.
    function localityAgeRange(loc) {
        const from = Number(loc.age.from);
        const to = Number(loc.age.to);
        if (isFinite(from) && isFinite(to)) {
            return [Math.max(from, to), Math.min(from, to)];
        }
        const about = Number(loc.age.about);
        if (isFinite(about)) return [about, about];
        return null;
    }

    function localityPeriodColor(loc) {
        const raw = (loc.age && loc.age.period) || "";
        const key = EPOCH_TO_PERIOD[raw] || raw;
        const p = periodsByKey[key];
        return p ? p.color : "#888";
    }

    /* ------- Map ------- */

    let leafletMap = null;
    const markersByKey = {};

    function initMap() {
        const lats = window.LOCALITIES.map(l => l.coords[0]);
        const lons = window.LOCALITIES.map(l => l.coords[1]);
        const avgLat = lats.reduce((a, b) => a + b, 0) / (lats.length || 1);
        const avgLon = lons.reduce((a, b) => a + b, 0) / (lons.length || 1);

        leafletMap = L.map("map").setView([avgLat, avgLon], 3);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            minZoom: 2,
            maxZoom: 12,
        }).addTo(leafletMap);

        for (const loc of window.LOCALITIES) {
            const color = localityPeriodColor(loc);
            const marker = L.circleMarker(loc.coords, {
                radius: 9,
                color: "#222",
                weight: 1.5,
                fillColor: color,
                fillOpacity: 0.85,
            });
            marker.locality = loc;
            marker.bindPopup(() => renderPopup(loc, getCurrentLang()));
            marker.addTo(leafletMap);
            markersByKey[loc.key] = marker;
        }
    }

    function renderPopup(loc, lang) {
        const name = localizedName(loc.name, lang);
        const periodTr = tr(lang, loc.age.period, loc.age.period || "");
        const unit = tr(lang, "ma-unit", "Ma");
        let ageStr = "";
        if (loc.age.from != null && loc.age.to != null) {
            const older = Math.max(Number(loc.age.from), Number(loc.age.to));
            const newer = Math.min(Number(loc.age.from), Number(loc.age.to));
            ageStr = `${older}–${newer} ${unit}`;
        } else if (loc.age.about != null) {
            ageStr = `~${loc.age.about} ${unit}`;
        }
        const img = loc.thumbnail
            ? `<img class="popup-img" src="${window.ROOT_PREFIX}${loc.thumbnail}" alt="${name}">`
            : "";
        return `
            <a href="${window.ROOT_PREFIX}${loc.url}" style="text-decoration: none; color: inherit;">
                <div class="popup-content">
                    <div class="popup-title">${name}</div>
                    <div class="popup-meta">${capitalize(periodTr)}${ageStr ? ", " + ageStr : ""}</div>
                    ${img}
                </div>
            </a>
        `;
    }

    /* ------- Timeline ------- */

    const timelineMargin = { left: 18, right: 18, top: 22, bottom: 32 };
    let timelineWidth = 1000;
    let timelineHeight = 220;
    let timeMin = 0;   // newest Ma at right edge
    let timeMax = 600; // oldest Ma at left edge

    function maToX(ma) {
        const w = timelineWidth - timelineMargin.left - timelineMargin.right;
        const frac = (timeMax - ma) / (timeMax - timeMin);
        return timelineMargin.left + frac * w;
    }

    function xToMa(x) {
        const w = timelineWidth - timelineMargin.left - timelineMargin.right;
        const frac = (x - timelineMargin.left) / w;
        return timeMax - frac * (timeMax - timeMin);
    }

    function initTimeline() {
        // Snap range to the enclosing ICS periods on either side.
        let dataMax = -Infinity;
        let dataMin = Infinity;
        for (const loc of window.LOCALITIES) {
            const r = localityAgeRange(loc);
            if (!r) continue;
            if (r[0] > dataMax) dataMax = r[0];
            if (r[1] < dataMin) dataMin = r[1];
        }
        const periods = window.ICS_PERIODS;
        const enclosingOldest = periods.find(p => p.from >= dataMax && p.to <= dataMax) || periods[0];
        const enclosingNewest = [...periods].reverse().find(p => p.to <= dataMin && p.from >= dataMin) || periods[periods.length - 1];
        timeMax = enclosingOldest.from;
        timeMin = enclosingNewest.to;

        filterState.ageFrom = timeMax;
        filterState.ageTo = timeMin;

        const wrapper = document.getElementById("timeline-wrapper");
        timelineWidth = wrapper.clientWidth;
        const svg = document.getElementById("timeline-svg");
        svg.setAttribute("viewBox", `0 0 ${timelineWidth} ${timelineHeight}`);
        svg.setAttribute("width", timelineWidth);
        svg.setAttribute("height", timelineHeight);

        renderTimelinePeriods();
        renderTimelineMarkers();
        positionHandles();
        renderHandleLabels();
        setupHandleDrag();

        window.addEventListener("resize", onTimelineResize);
    }

    function onTimelineResize() {
        const wrapper = document.getElementById("timeline-wrapper");
        timelineWidth = wrapper.clientWidth;
        const svg = document.getElementById("timeline-svg");
        svg.setAttribute("viewBox", `0 0 ${timelineWidth} ${timelineHeight}`);
        svg.setAttribute("width", timelineWidth);
        renderTimelinePeriods();
        renderTimelineMarkers();
        positionHandles();
        renderHandleLabels();
    }

    function renderTimelinePeriods() {
        const svg = document.getElementById("timeline-svg");
        for (const el of [...svg.querySelectorAll(".period-band, .period-label, .ma-boundary")]) {
            el.remove();
        }
        const lang = getCurrentLang();
        const bandTop = timelineMargin.top;
        const bandHeight = timelineHeight - timelineMargin.top - timelineMargin.bottom;
        for (const p of window.ICS_PERIODS) {
            if (p.from < timeMin || p.to > timeMax) continue;
            const xFrom = maToX(p.from);
            const xTo = maToX(p.to);
            const width = Math.max(0, xTo - xFrom);

            const rect = document.createElementNS(SVG_NS, "rect");
            rect.setAttribute("class", "period-band");
            rect.setAttribute("x", xFrom);
            rect.setAttribute("y", bandTop);
            rect.setAttribute("width", width);
            rect.setAttribute("height", bandHeight);
            rect.setAttribute("fill", p.color);
            rect.setAttribute("opacity", "0.45");
            svg.appendChild(rect);

            if (width >= 6) {
                const label = document.createElementNS(SVG_NS, "text");
                label.setAttribute("class", "period-label");
                const text = capitalize(tr(lang, p.key, p.key));
                label.textContent = text;
                const cx = (xFrom + xTo) / 2;
                const cy = bandTop + bandHeight / 2 + 4;
                label.setAttribute("font-size", "12");
                label.setAttribute("fill", "#222");
                label.setAttribute("text-anchor", "middle");
                // Rough estimate: 12px font, average glyph width ~6.5px.
                const approxTextWidth = text.length * 6.5;
                if (width >= approxTextWidth + 8) {
                    // Horizontal label fits.
                    label.setAttribute("x", cx);
                    label.setAttribute("y", cy);
                } else {
                    // Rotate -90° so text reads bottom-to-top within a narrow band.
                    label.setAttribute("x", cx);
                    label.setAttribute("y", cy);
                    label.setAttribute("transform", `rotate(-90, ${cx}, ${cy})`);
                }
                svg.appendChild(label);
            }
        }

        // Ma boundary labels below the band.
        const seenMa = new Set();
        const boundaries = [];
        for (const p of window.ICS_PERIODS) {
            if (p.from <= timeMax && p.from >= timeMin && !seenMa.has(p.from)) {
                boundaries.push(p.from); seenMa.add(p.from);
            }
            if (p.to <= timeMax && p.to >= timeMin && !seenMa.has(p.to)) {
                boundaries.push(p.to); seenMa.add(p.to);
            }
        }
        boundaries.sort((a, b) => b - a);
        // Skip labels that would overlap (keep older one).
        const labelY = bandTop + bandHeight + 14;
        let lastX = -Infinity;
        for (const ma of boundaries) {
            const x = maToX(ma);
            if (Math.abs(x - lastX) < 32) continue;
            lastX = x;

            const tick = document.createElementNS(SVG_NS, "line");
            tick.setAttribute("class", "ma-boundary");
            tick.setAttribute("x1", x);
            tick.setAttribute("x2", x);
            tick.setAttribute("y1", bandTop + bandHeight);
            tick.setAttribute("y2", bandTop + bandHeight + 4);
            tick.setAttribute("stroke", "#555");
            tick.setAttribute("stroke-width", "1");
            svg.appendChild(tick);

            const t = document.createElementNS(SVG_NS, "text");
            t.setAttribute("class", "ma-boundary");
            t.setAttribute("x", x);
            t.setAttribute("y", labelY);
            t.setAttribute("text-anchor", "middle");
            t.setAttribute("font-size", "10");
            t.setAttribute("fill", "#555");
            t.textContent = ma === Math.floor(ma) ? String(ma) : ma.toFixed(1);
            svg.appendChild(t);
        }
    }

    function renderTimelineMarkers() {
        const svg = document.getElementById("timeline-svg");
        for (const el of [...svg.querySelectorAll(".loc-marker")]) {
            el.remove();
        }
        const bandTop = timelineMargin.top;
        const bandHeight = timelineHeight - timelineMargin.top - timelineMargin.bottom;
        const lang = getCurrentLang();

        const withRange = window.LOCALITIES
            .map(loc => ({ loc, range: localityAgeRange(loc) }))
            .filter(r => r.range)
            .sort((a, b) => b.range[0] - a.range[0]);

        // Markers are stadium-shaped (rect with full rounding):
        //   - point ages (about-only): rendered as a circle of diameter `markerHeight`
        //   - ranged ages: rendered as a pill spanning [xFrom, xTo]
        // Stacked in rows to avoid x-overlap.
        const markerHeight = 10;
        const markerRadius = markerHeight / 2;
        const rowGap = 2;
        const rowStep = markerHeight + rowGap;
        const rows = [];

        for (const { loc, range } of withRange) {
            const [olderMa, newerMa] = range;
            const xFrom = maToX(olderMa);
            const xTo = maToX(newerMa);
            const naturalWidth = xTo - xFrom;
            const width = Math.max(markerHeight, naturalWidth);
            const xMid = (xFrom + xTo) / 2;
            const x = xMid - width / 2;
            const xRight = x + width;

            let rowIdx = 0;
            while (rowIdx < rows.length && rows[rowIdx].some(seg => !(xRight < seg.x - 2 || x > seg.xRight + 2))) {
                rowIdx++;
            }
            if (rowIdx === rows.length) rows.push([]);
            rows[rowIdx].push({ x, xRight });

            // Stack from the bottom of the band upward, leaving the upper half
            // of the band free for the rotated period labels.
            const y = bandTop + bandHeight - (rowIdx + 1) * rowStep - 2;

            const g = document.createElementNS(SVG_NS, "g");
            g.setAttribute("class", "loc-marker");
            g.dataset.locKey = loc.key;
            g.style.cursor = "pointer";

            const rect = document.createElementNS(SVG_NS, "rect");
            rect.setAttribute("x", x);
            rect.setAttribute("y", Math.max(bandTop + 4, y));
            rect.setAttribute("width", width);
            rect.setAttribute("height", markerHeight);
            rect.setAttribute("rx", markerRadius);
            rect.setAttribute("ry", markerRadius);
            rect.setAttribute("fill", localityPeriodColor(loc));
            rect.setAttribute("stroke", "#222");
            rect.setAttribute("stroke-width", "1");
            g.appendChild(rect);

            const title = document.createElementNS(SVG_NS, "title");
            const periodTr = tr(lang, loc.age.period, loc.age.period || "");
            const unit = tr(lang, "ma-unit", "Ma");
            title.textContent = `${localizedName(loc.name, lang)} (${capitalize(periodTr)}, ${olderMa}–${newerMa} ${unit})`;
            g.appendChild(title);

            g.addEventListener("click", () => {
                window.location.href = window.ROOT_PREFIX + loc.url;
            });
            svg.appendChild(g);
        }
    }

    function positionHandles() {
        const handleOlder = document.getElementById("handle-older");
        const handleNewer = document.getElementById("handle-newer");
        handleOlder.style.left = maToX(filterState.ageFrom) + "px";
        handleNewer.style.left = maToX(filterState.ageTo) + "px";
    }

    function renderHandleLabels() {
        const container = document.getElementById("timeline-handle-labels");
        container.innerHTML = "";
        const unit = tr(getCurrentLang(), "ma-unit", "Ma");
        function makeLabel(ma, side) {
            const x = maToX(ma);
            const el = document.createElement("div");
            el.className = "handle-label";
            el.style.left = x + "px";
            el.textContent = (ma === Math.floor(ma) ? String(ma) : ma.toFixed(1)) + " " + unit;
            container.appendChild(el);
            return el;
        }
        makeLabel(filterState.ageFrom, "older");
        makeLabel(filterState.ageTo, "newer");
    }

    function setupHandleDrag() {
        const wrapper = document.getElementById("timeline-wrapper");
        const handleOlder = document.getElementById("handle-older");
        const handleNewer = document.getElementById("handle-newer");

        function attach(handle, which) {
            handle.addEventListener("mousedown", startDrag);
            handle.addEventListener("touchstart", startDrag, { passive: false });

            function startDrag(e) {
                e.preventDefault();
                const onMove = (ev) => {
                    const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
                    const rect = wrapper.getBoundingClientRect();
                    const x = Math.max(timelineMargin.left, Math.min(timelineWidth - timelineMargin.right, clientX - rect.left));
                    let ma = xToMa(x);
                    if (which === "older") {
                        ma = Math.max(filterState.ageTo + 0.1, Math.min(timeMax, ma));
                        filterState.ageFrom = ma;
                    } else {
                        ma = Math.max(timeMin, Math.min(filterState.ageFrom - 0.1, ma));
                        filterState.ageTo = ma;
                    }
                    positionHandles();
                    renderHandleLabels();
                    applyFilters();
                };
                const onUp = () => {
                    window.removeEventListener("mousemove", onMove);
                    window.removeEventListener("mouseup", onUp);
                    window.removeEventListener("touchmove", onMove);
                    window.removeEventListener("touchend", onUp);
                };
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
                window.addEventListener("touchmove", onMove, { passive: false });
                window.addEventListener("touchend", onUp);
            }
        }

        attach(handleOlder, "older");
        attach(handleNewer, "newer");
    }

    /* ------- Country pills ------- */

    function initCountryPills() {
        const container = document.getElementById("country-pills");
        const lang = getCurrentLang();
        const usedCountries = new Set(window.LOCALITIES.map(l => l.country));
        const sortedCodes = [...usedCountries].sort();
        for (const code of sortedCodes) {
            const pill = document.createElement("button");
            pill.type = "button";
            pill.className = "filter-pill";
            pill.dataset.country = code;
            pill.innerHTML = pillCountryHTML(code, lang);
            pill.addEventListener("click", () => {
                if (filterState.countries.has(code)) {
                    filterState.countries.delete(code);
                    pill.classList.remove("active");
                } else {
                    filterState.countries.add(code);
                    pill.classList.add("active");
                }
                applyFilters();
            });
            container.appendChild(pill);
        }
    }

    function pillCountryHTML(code, lang) {
        const flag = COUNTRY_FLAGS[code] || "";
        const countryInfo = window.COUNTRIES[code];
        const name = countryInfo ? localizedName(countryInfo.name, lang) : tr(lang, code, code);
        return `<span class="pill-flag">${flag}</span><span class="pill-text">${name}</span>`;
    }

    function refreshCountryPillLabels() {
        const lang = getCurrentLang();
        for (const pill of document.querySelectorAll("#country-pills .filter-pill")) {
            pill.innerHTML = pillCountryHTML(pill.dataset.country, lang);
        }
    }

    /* ------- Major taxa pills ------- */

    function pillTaxonHTML(key, lang) {
        const taxon = taxaByKey[key];
        const name = taxon ? capitalize(localizedName(taxon.names, lang)) : key;
        const url = (window.TAXON_ICON_URLS || {})[key];
        const emoji = TAXON_ICONS[key] || "";
        const icon = url
            ? `<img class="pill-icon" src="${url}" alt="" loading="lazy">`
            : `<span class="pill-flag">${emoji}</span>`;
        return `${icon}<span class="pill-text">${name}</span>`;
    }

    function initMajorTaxaPills() {
        const container = document.getElementById("major-taxa-pills");
        const lang = getCurrentLang();
        for (const key of window.MAJOR_TAXA) {
            if (!taxaByKey[key]) continue;
            const pill = document.createElement("button");
            pill.type = "button";
            pill.className = "filter-pill taxon-pill";
            pill.dataset.taxon = key;
            pill.innerHTML = pillTaxonHTML(key, lang);
            pill.addEventListener("click", () => {
                if (filterState.taxa.has(key)) {
                    filterState.taxa.delete(key);
                    pill.classList.remove("active");
                } else {
                    filterState.taxa.add(key);
                    pill.classList.add("active");
                }
                renderTaxonChips();
                applyFilters();
            });
            container.appendChild(pill);
        }
    }

    function refreshMajorTaxaPillLabels() {
        const lang = getCurrentLang();
        for (const pill of document.querySelectorAll("#major-taxa-pills .filter-pill")) {
            pill.innerHTML = pillTaxonHTML(pill.dataset.taxon, lang);
        }
    }

    function refreshMajorTaxaPillActiveState() {
        for (const pill of document.querySelectorAll("#major-taxa-pills .filter-pill")) {
            const key = pill.dataset.taxon;
            pill.classList.toggle("active", filterState.taxa.has(key));
        }
    }

    /* ------- Taxon search + chips ------- */

    function initTaxonSearch() {
        const input = document.getElementById("taxon-search");
        const results = document.getElementById("taxon-search-results");

        input.addEventListener("input", () => {
            const q = input.value.trim().toLowerCase();
            results.innerHTML = "";
            if (!q) {
                results.style.display = "none";
                return;
            }
            const lang = getCurrentLang();
            const matches = window.TAXA_INDEX
                .filter(t => {
                    const names = [t.names.el, t.names.en, t.names.grc].filter(Boolean).map(s => s.toLowerCase());
                    return names.some(n => n.includes(q)) && !filterState.taxa.has(t.key);
                })
                .slice(0, 12);
            if (matches.length === 0) {
                results.style.display = "none";
                return;
            }
            results.style.display = "block";
            for (const t of matches) {
                const item = document.createElement("div");
                item.className = "search-result-item";
                const label = `${capitalize(localizedName(t.names, lang))}${t.rank ? " (" + tr(lang, t.rank, t.rank) + ")" : ""}`;
                const iconHTML = t.icon
                    ? `<img class="search-result-icon" src="${t.icon}" alt="" loading="lazy">`
                    : `<span class="search-result-icon-placeholder"></span>`;
                item.innerHTML = `${iconHTML}<span>${label}</span>`;
                item.addEventListener("click", () => {
                    filterState.taxa.add(t.key);
                    input.value = "";
                    results.innerHTML = "";
                    results.style.display = "none";
                    renderTaxonChips();
                    refreshMajorTaxaPillActiveState();
                    applyFilters();
                });
                results.appendChild(item);
            }
        });

        document.addEventListener("click", (e) => {
            if (!e.target.closest(".search-wrapper")) {
                results.style.display = "none";
            }
        });
    }

    function renderTaxonChips() {
        const container = document.getElementById("selected-taxa-chips");
        container.innerHTML = "";
        const lang = getCurrentLang();
        for (const key of filterState.taxa) {
            const taxon = taxaByKey[key];
            if (!taxon) continue;
            const chip = document.createElement("span");
            chip.className = "filter-chip";
            chip.textContent = capitalize(localizedName(taxon.names, lang));
            const x = document.createElement("button");
            x.type = "button";
            x.className = "chip-remove";
            x.textContent = "×";
            x.addEventListener("click", () => {
                filterState.taxa.delete(key);
                renderTaxonChips();
                refreshMajorTaxaPillActiveState();
                applyFilters();
            });
            chip.appendChild(x);
            container.appendChild(chip);
        }
    }

    function refreshSearchPlaceholder() {
        const lang = getCurrentLang();
        const input = document.getElementById("taxon-search");
        input.placeholder = tr(lang, "filter-search-placeholder", "Search a taxon...");
    }

    /* ------- Clear-all button ------- */

    function initClearButton() {
        const btn = document.getElementById("filter-clear-all");
        btn.addEventListener("click", () => {
            filterState.countries.clear();
            filterState.taxa.clear();
            filterState.ageFrom = timeMax;
            filterState.ageTo = timeMin;
            for (const pill of document.querySelectorAll(".filter-pill")) {
                pill.classList.remove("active");
            }
            renderTaxonChips();
            positionHandles();
            renderHandleLabels();
            applyFilters();
        });
    }

    /* ------- Apply filters ------- */

    function localityMatches(loc) {
        if (filterState.countries.size > 0 && !filterState.countries.has(loc.country)) {
            return false;
        }
        if (filterState.taxa.size > 0) {
            const present = new Set(loc.taxa_present || []);
            let any = false;
            for (const t of filterState.taxa) {
                if (present.has(t)) { any = true; break; }
            }
            if (!any) return false;
        }
        const range = localityAgeRange(loc);
        if (range) {
            const [older, newer] = range;
            // Locality interval [newer, older] must intersect filter window [ageTo, ageFrom]
            if (older < filterState.ageTo || newer > filterState.ageFrom) return false;
        }
        return true;
    }

    function applyFilters() {
        const matched = [];
        for (const loc of window.LOCALITIES) {
            const match = localityMatches(loc);
            if (match) matched.push(loc);
            // Map marker — keep visible, change opacity.
            const marker = markersByKey[loc.key];
            if (marker) {
                marker.setStyle({
                    fillOpacity: match ? 0.9 : 0.06,
                    opacity: match ? 1 : 0.18,
                });
            }
            // Timeline marker
            const svgMarker = document.querySelector(`#timeline-svg .loc-marker[data-loc-key="${loc.key}"]`);
            if (svgMarker) {
                svgMarker.style.opacity = match ? "1" : "0.12";
            }
        }
        // Fit map to matched localities.
        if (leafletMap && matched.length > 0) {
            const bounds = L.latLngBounds(matched.map(l => l.coords));
            leafletMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 8, animate: true });
        }
    }

    /* ------- Language change reactivity ------- */

    function onLanguageChange() {
        refreshCountryPillLabels();
        refreshMajorTaxaPillLabels();
        refreshSearchPlaceholder();
        renderTaxonChips();
        renderTimelinePeriods();
        renderTimelineMarkers();
        positionHandles();
        renderHandleLabels();
        // Refresh open popups
        for (const key in markersByKey) {
            const m = markersByKey[key];
            if (m.isPopupOpen()) {
                m.setPopupContent(renderPopup(m.locality, getCurrentLang()));
            }
        }
    }

    function watchLanguageChanges() {
        const orig = window.setLanguage;
        if (typeof orig === "function") {
            window.setLanguage = function (lang) {
                orig(lang);
                setTimeout(onLanguageChange, 50);
            };
        }
        window.addEventListener("storage", (e) => {
            if (e.key === "language") onLanguageChange();
        });
    }

    /* ------- Boot ------- */

    function whenReady(fn) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", fn);
        } else {
            fn();
        }
    }

    whenReady(() => {
        initMap();
        initTimeline();
        initCountryPills();
        initMajorTaxaPills();
        initTaxonSearch();
        initClearButton();
        refreshSearchPlaceholder();
        applyFilters();
        watchLanguageChanges();

        const tryRefresh = () => {
            const gd = (typeof globalDict !== "undefined") ? globalDict : null;
            if (gd && Object.keys(gd).length) {
                onLanguageChange();
            } else {
                setTimeout(tryRefresh, 100);
            }
        };
        tryRefresh();
    });
})();
