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
        ua: "🇺🇦",
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
        groupLayer = L.layerGroup().addTo(leafletMap);
        fanLayer = L.layerGroup().addTo(leafletMap);
        // Attribution is required by the OpenStreetMap tile usage policy and was
        // missing. The tiles themselves are muted towards the site's palette by a
        // CSS filter (see .leaflet-tile in explore.css) rather than by switching to
        // another tile host, so this stays a single, properly credited source.
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            minZoom: 2,
            maxZoom: 12,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(leafletMap);

        for (const loc of window.LOCALITIES) {
            const color = localityPeriodColor(loc);
            const marker = L.circleMarker(loc.coords, {
                radius: 9,
                color: "#222",
                weight: 1.5,
                fillColor: color,
                fillOpacity: 0.85,
                // Paths bubble their clicks up to the map by default, which would
                // let a click on a fanned-out dot also count as a click on the
                // background and collapse the group under it.
                bubblingMouseEvents: false,
            });
            marker.locality = loc;
            marker.bindPopup(() => renderPopup(loc, getCurrentLang()));
            marker.addTo(leafletMap);
            markersByKey[loc.key] = marker;
        }

        renderGroups();
        // Which dots overlap depends only on the zoom level, not on panning.
        leafletMap.on("zoomend", renderGroups);
        leafletMap.on("click", closeGroup);
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") closeGroup();
        });
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
            <a href="${documentHref(loc.url)}" style="text-decoration: none; color: inherit;">
                <div class="popup-content">
                    <div class="popup-title">${name}</div>
                    <div class="popup-meta">${capitalize(periodTr)}${ageStr ? ", " + ageStr : ""}</div>
                    ${img}
                </div>
            </a>
        `;
    }

    /* ------- Overlapping localities ------- */

    /*
     * Localities can sit close enough to hide one another: the Alnif and Dorset
     * sites are a couple of kilometres apart, which is nothing at world zoom,
     * and two formations collected at one village share a single set of
     * coordinates at every zoom. Dots that overlap on screen are therefore
     * replaced by one badge carrying the member count; clicking it fans the
     * members out on a small ring with their names attached, so any of them can
     * be picked.
     */

    // Centre-to-centre screen distance below which two dots (radius 9) are
    // considered to be covering each other.
    const GROUP_OVERLAP_PX = 26;
    // Ring radius the members are fanned out onto, grown for crowded groups.
    const FAN_RADIUS_PX = 38;

    let groupLayer = null;      // the badges standing in for grouped dots
    let fanLayer = null;        // leader lines, drawn only while a group is open
    let groups = [];            // groups for the current zoom level
    let groupByKey = {};        // locality key -> its group, for grouped localities
    let openedGroup = null;

    // Group localities whose dots overlap at the current zoom. Overlap is
    // transitive here (single-link): a chain of touching dots becomes one group,
    // which is what the eye sees anyway.
    function computeGroups() {
        const zoom = leafletMap.getZoom();
        const points = window.LOCALITIES.map(loc => leafletMap.project(L.latLng(loc.coords), zoom));

        const parent = points.map((_, i) => i);
        const find = (i) => {
            while (parent[i] !== i) {
                parent[i] = parent[parent[i]];
                i = parent[i];
            }
            return i;
        };
        for (let i = 0; i < points.length; i++) {
            for (let j = i + 1; j < points.length; j++) {
                if (points[i].distanceTo(points[j]) >= GROUP_OVERLAP_PX) continue;
                const a = find(i);
                const b = find(j);
                if (a !== b) parent[b] = a;
            }
        }

        const byRoot = new Map();
        window.LOCALITIES.forEach((loc, i) => {
            const root = find(i);
            if (!byRoot.has(root)) byRoot.set(root, []);
            byRoot.get(root).push({ loc, pt: points[i] });
        });

        const result = [];
        for (const entries of byRoot.values()) {
            if (entries.length < 2) continue;
            let x = 0;
            let y = 0;
            for (const e of entries) {
                x += e.pt.x;
                y += e.pt.y;
            }
            const center = leafletMap.unproject(L.point(x / entries.length, y / entries.length), zoom);
            result.push({ members: entries.map(e => e.loc), center, badge: null });
        }
        return result;
    }

    // The badge wears its members' period colours as equal slices, so a group
    // still says which periods are hiding inside it.
    function groupBadgeIcon(group) {
        const colors = group.members.map(localityPeriodColor);
        const step = 100 / colors.length;
        const stops = colors
            .map((c, i) => `${c} ${(i * step).toFixed(2)}% ${((i + 1) * step).toFixed(2)}%`)
            .join(", ");
        return L.divIcon({
            className: "loc-group",
            html:
                `<span class="loc-group-inner">` +
                `<span class="loc-group-ring" style="background: conic-gradient(${stops})"></span>` +
                `<span class="loc-group-count">${colors.length}</span>` +
                `</span>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15],
        });
    }

    function renderGroups() {
        closeGroup();
        groupLayer.clearLayers();
        groups = computeGroups();
        groupByKey = {};

        // Start from every dot visible, then hide the ones a badge now covers.
        for (const loc of window.LOCALITIES) {
            const marker = markersByKey[loc.key];
            if (marker && !leafletMap.hasLayer(marker)) marker.addTo(leafletMap);
        }
        for (const group of groups) {
            for (const loc of group.members) {
                groupByKey[loc.key] = group;
                leafletMap.removeLayer(markersByKey[loc.key]);
            }
            const badge = L.marker(group.center, { icon: groupBadgeIcon(group), keyboard: false });
            badge.on("click", (e) => {
                L.DomEvent.stopPropagation(e.originalEvent || e);
                if (openedGroup === group) closeGroup();
                else openGroup(group);
            });
            badge.addTo(groupLayer);
            group.badge = badge;
        }
        updateGroupBadges();
    }

    function openGroup(group) {
        closeGroup();
        openedGroup = group;

        const zoom = leafletMap.getZoom();
        const centerPt = leafletMap.project(group.center, zoom);
        const n = group.members.length;
        const radius = FAN_RADIUS_PX + 7 * Math.max(0, n - 2);
        // A pair reads best side by side; three or more as a ring from the top.
        const startAngle = n === 2 ? 0 : -Math.PI / 2;
        const lang = getCurrentLang();
        const targets = [];

        group.members.forEach((loc, i) => {
            const angle = startAngle + (2 * Math.PI * i) / n;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const target = leafletMap.unproject(
                L.point(centerPt.x + radius * cos, centerPt.y + radius * sin), zoom);
            targets.push(target);

            // Leader line first, so the dot is drawn over its own line.
            L.polyline([group.center, target], {
                color: "#222",
                weight: 1.5,
                opacity: 0.5,
                dashArray: "3 3",
                interactive: false,
            }).addTo(fanLayer);

            const direction = cos > 0.3 ? "right" : cos < -0.3 ? "left" : (sin > 0 ? "bottom" : "top");
            const offset = direction === "right" ? [12, 0]
                : direction === "left" ? [-12, 0]
                : direction === "bottom" ? [0, 10] : [0, -10];
            const marker = markersByKey[loc.key];
            marker.setLatLng(target);
            marker.addTo(leafletMap);
            marker.bindTooltip(localizedName(loc.name, lang), {
                permanent: true,
                direction,
                offset,
                className: "loc-fan-label",
            });
        });

        // A group opened near an edge would fan half of itself out of sight, so
        // recentre on it. Panning leaves the zoom alone and the fan intact.
        const size = leafletMap.getSize();
        const marginX = radius + 90; // room for the name labels
        const marginY = radius + 30;
        const offscreen = targets.some(t => {
            const p = leafletMap.latLngToContainerPoint(t);
            return p.x < marginX || p.x > size.x - marginX || p.y < marginY || p.y > size.y - marginY;
        });
        if (offscreen) leafletMap.panTo(group.center, { animate: true });

        const el = group.badge.getElement();
        if (el) el.classList.add("is-open");
    }

    function closeGroup() {
        if (!openedGroup) return;
        for (const loc of openedGroup.members) {
            const marker = markersByKey[loc.key];
            marker.closePopup();
            marker.unbindTooltip();
            marker.setLatLng(loc.coords);
            leafletMap.removeLayer(marker);
        }
        fanLayer.clearLayers();
        const el = openedGroup.badge.getElement();
        if (el) el.classList.remove("is-open");
        openedGroup = null;
    }

    // A badge fades like its dots would: only when nothing inside it matches.
    function updateGroupBadges() {
        for (const group of groups) {
            const el = group.badge && group.badge.getElement();
            if (el) el.classList.toggle("is-dimmed", !group.members.some(localityMatches));
        }
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
                window.location.href = documentHref(loc.url);
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
                    // Fire on drag end, not per move, to avoid flooding events.
                    trackEvent("timeline_adjusted", {
                        from_ma: Math.round(filterState.ageFrom),
                        to_ma: Math.round(filterState.ageTo),
                    });
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
                    trackEvent("explore_filter", { filter_type: "country", filter_value: code });
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
                    trackEvent("explore_filter", { filter_type: "taxon", filter_value: key });
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

        let currentMatches = [];
        let highlightedIndex = -1;

        function setHighlight(idx) {
            const items = results.querySelectorAll(".search-result-item");
            items.forEach((el, i) => el.classList.toggle("highlighted", i === idx));
            highlightedIndex = idx;
            if (idx >= 0 && items[idx]) {
                items[idx].scrollIntoView({ block: "nearest" });
            }
        }

        function closeDropdown() {
            results.style.display = "none";
            results.innerHTML = "";
            currentMatches = [];
            highlightedIndex = -1;
        }

        function selectMatch(taxon) {
            filterState.taxa.add(taxon.key);
            trackEvent("explore_filter", { filter_type: "taxon", filter_value: taxon.key });
            input.value = "";
            closeDropdown();
            renderTaxonChips();
            refreshMajorTaxaPillActiveState();
            applyFilters();
        }

        input.addEventListener("input", () => {
            const q = input.value.trim().toLowerCase();
            results.innerHTML = "";
            currentMatches = [];
            highlightedIndex = -1;
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
            currentMatches = matches;
            results.style.display = "block";
            matches.forEach((t, i) => {
                const item = document.createElement("div");
                item.className = "search-result-item";
                const label = `${capitalize(localizedName(t.names, lang))}${t.rank ? " (" + tr(lang, t.rank, t.rank) + ")" : ""}`;
                const iconHTML = t.icon
                    ? `<img class="search-result-icon" src="${t.icon}" alt="" loading="lazy">`
                    : `<span class="search-result-icon-placeholder"></span>`;
                item.innerHTML = `${iconHTML}<span>${label}</span>`;
                item.addEventListener("click", () => selectMatch(t));
                item.addEventListener("mouseenter", () => setHighlight(i));
                results.appendChild(item);
            });
            // Auto-highlight the first match so Enter selects it immediately.
            setHighlight(0);
        });

        input.addEventListener("keydown", (e) => {
            if (results.style.display === "none" || currentMatches.length === 0) {
                if (e.key === "Escape") {
                    closeDropdown();
                    e.preventDefault();
                }
                return;
            }
            switch (e.key) {
                case "ArrowDown":
                    setHighlight(Math.min(currentMatches.length - 1, highlightedIndex + 1));
                    e.preventDefault();
                    break;
                case "ArrowUp":
                    setHighlight(Math.max(0, highlightedIndex - 1));
                    e.preventDefault();
                    break;
                case "Enter":
                    if (highlightedIndex >= 0 && currentMatches[highlightedIndex]) {
                        selectMatch(currentMatches[highlightedIndex]);
                        e.preventDefault();
                    }
                    break;
                case "Escape":
                    closeDropdown();
                    e.preventDefault();
                    break;
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
            const iconUrl = (window.TAXON_ICON_URLS || {})[key];
            if (iconUrl) {
                const img = document.createElement("img");
                img.className = "chip-icon";
                img.src = iconUrl;
                img.alt = "";
                img.loading = "lazy";
                chip.appendChild(img);
            }
            const label = document.createElement("span");
            label.className = "pill-text";
            label.textContent = capitalize(localizedName(taxon.names, lang));
            chip.appendChild(label);
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

    function applyFilters(fitMap = true) {
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
        updateGroupBadges();
        // Fit map to matched localities.
        if (fitMap && leafletMap && matched.length > 0) {
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
        // Refresh the labels of an open group
        if (openedGroup) {
            for (const loc of openedGroup.members) {
                const m = markersByKey[loc.key];
                if (m.getTooltip()) m.setTooltipContent(localizedName(loc.name, getCurrentLang()));
            }
        }
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
        // Deep-link from a locality page: ?locality=<key> focuses that marker.
        const focusKey = new URLSearchParams(location.search).get("locality");

        initMap();
        initTimeline();
        initCountryPills();
        initMajorTaxaPills();
        initTaxonSearch();
        initClearButton();
        refreshSearchPlaceholder();
        // Skip the fit-to-all when focusing a single locality.
        applyFilters(!focusKey);
        if (focusKey && markersByKey[focusKey]) {
            const m = markersByKey[focusKey];
            leafletMap.setView(m.locality.coords, 9, { animate: false });
            // The view change regroups the dots; if the target ended up inside a
            // group, fan it out so the deep link still lands on its own marker.
            const group = groupByKey[focusKey];
            if (group) openGroup(group);
            m.openPopup();
        }
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
