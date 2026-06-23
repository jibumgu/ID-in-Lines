(() => {
    "use strict";

    const canvas = document.querySelector("#lineCanvas");
    const ctx = canvas.getContext("2d");

    const addBarBtn = document.querySelector("#addBarBtn");
    const revealBtn = document.querySelector("#revealBtn");
    const brandStatus = document.querySelector("#brandStatus");
    const zoomOutBtn = document.querySelector("#zoomOutBtn");
    const zoomInBtn = document.querySelector("#zoomInBtn");
    const resetViewBtn = document.querySelector("#resetViewBtn");
    const selectedLabel = document.querySelector("#selectedLabel");
    const barTitleInput = document.querySelector("#barTitleInput");
    const barWidthInput = document.querySelector("#barWidthInput");
    const barHeightInput = document.querySelector("#barHeightInput");
    const barColorInput = document.querySelector("#barColorInput");
    const moveBarLeftBtn = document.querySelector("#moveBarLeftBtn");
    const moveBarRightBtn = document.querySelector("#moveBarRightBtn");
    const resetBarBtn = document.querySelector("#resetBarBtn");
    const deleteBarBtn = document.querySelector("#deleteBarBtn");
    const planTextInput = document.querySelector("#planTextInput");
    const addTaskBtn = document.querySelector("#addTaskBtn");
    const taskList = document.querySelector("#taskList");
    const planCount = document.querySelector("#planCount");
    const revealPanel = document.querySelector("#revealPanel");
    const toast = document.querySelector("#toast");

    const MIN_ZOOM = 0.28;
    const MAX_ZOOM = 3.4;
    const DEFAULT_COLOR = "#111111";
    const STORAGE_KEY = "id-in-lines-state-v1";
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const state = {
        bars: [],
        selectedBarId: null,
        selectedTaskId: null,
        camera: {
            x: 0,
            y: 0,
            zoom: 1,
        },
        canvasSize: {
            width: 0,
            height: 0,
            dpr: 1,
        },
        pointer: {
            active: false,
            moved: false,
            startX: 0,
            startY: 0,
            lastX: 0,
            lastY: 0,
        },
        mouse: {
            x: null,
            y: null,
            inside: false,
        },
        revealed: false,
        didFit: false,
        renderRequested: true,
        progressAnimating: false,
        reduceMotion: motionQuery.matches,
        idSeed: 0,
        toastTimer: null,
        storageWarningShown: false,
    };

    function nextId(prefix) {
        state.idSeed += 1;
        return `${prefix}-${state.idSeed}`;
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function makeBar(width, height, gapAfter) {
        return {
            id: nextId("bar"),
            title: "",
            customTitle: false,
            x: 0,
            width,
            height,
            gapAfter,
            color: DEFAULT_COLOR,
            tasks: [],
            displayProgress: 0,
        };
    }

    function createInitialBars() {
        const widths = [8, 18, 5, 12, 24, 7, 15, 5, 11, 28, 6, 14, 21, 5, 10, 17, 7, 22];
        const gaps = [14, 8, 20, 12, 9, 18, 10, 16];

        state.bars = widths.map((width, index) => {
            const height = 260 + ((index % 5) * 22);
            return makeBar(width, height, gaps[index % gaps.length]);
        });

        renumberBars();
        layoutBars();
    }

    function serializeBar(bar) {
        return {
            id: bar.id,
            title: bar.title,
            customTitle: bar.customTitle,
            width: bar.width,
            height: bar.height,
            gapAfter: bar.gapAfter,
            color: bar.color,
            tasks: bar.tasks.map((task) => ({
                id: task.id,
                text: task.text,
                done: task.done,
            })),
        };
    }

    function saveState() {
        const snapshot = {
            idSeed: state.idSeed,
            selectedBarId: state.selectedBarId,
            selectedTaskId: state.selectedTaskId,
            revealed: state.revealed,
            bars: state.bars.map(serializeBar),
        };

        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
        } catch (error) {
            console.warn("ID-in-Lines could not save state.", error);
            if (!state.storageWarningShown) {
                state.storageWarningShown = true;
                showToast("현재 브라우저에서 저장이 제한되었습니다.");
            }
        }
    }

    function getHighestSavedId(bars) {
        return bars.reduce((highest, bar) => {
            const barNumber = Number(String(bar.id).split("-").pop()) || 0;
            const taskHighest = bar.tasks.reduce((taskMax, task) => {
                const taskNumber = Number(String(task.id).split("-").pop()) || 0;
                return Math.max(taskMax, taskNumber);
            }, 0);

            return Math.max(highest, barNumber, taskHighest);
        }, 0);
    }

    function loadState() {
        try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            if (!raw) return false;

            const saved = JSON.parse(raw);
            if (!saved || !Array.isArray(saved.bars) || saved.bars.length === 0) return false;

            state.bars = saved.bars.map((bar) => ({
                id: typeof bar.id === "string" ? bar.id : nextId("bar"),
                title: typeof bar.title === "string" ? bar.title : "",
                customTitle: Boolean(bar.customTitle),
                x: 0,
                width: clamp(Number(bar.width) || 12, 4, 34),
                height: clamp(Number(bar.height) || 260, 160, 460),
                gapAfter: clamp(Number(bar.gapAfter) || 14, 6, 32),
                color: normalizeColor(bar.color || DEFAULT_COLOR),
                tasks: Array.isArray(bar.tasks)
                    ? bar.tasks.map((task) => ({
                        id: typeof task.id === "string" ? task.id : nextId("task"),
                        text: typeof task.text === "string" ? task.text : "",
                        done: Boolean(task.done),
                    }))
                    : [],
                displayProgress: 0,
            }));

            state.idSeed = Math.max(Number(saved.idSeed) || 0, state.idSeed, getHighestSavedId(state.bars));
            state.selectedBarId = null;
            state.selectedTaskId = null;
            state.revealed = Boolean(saved.revealed);
            renumberBars();
            layoutBars();
            return true;
        } catch (error) {
            console.warn("ID-in-Lines could not load state.", error);
            if (!state.storageWarningShown) {
                state.storageWarningShown = true;
                showToast("저장된 데이터를 불러오지 못했습니다.");
            }
            return false;
        }
    }

    function renumberBars() {
        state.bars.forEach((bar, index) => {
            if (!bar.customTitle) {
                bar.title = `Line${String(index + 1).padStart(2, "0")}`;
            }
        });
    }

    function layoutBars() {
        if (state.bars.length === 0) return;

        const totalWidth = state.bars.reduce((sum, bar, index) => {
            const gap = index < state.bars.length - 1 ? bar.gapAfter : 0;
            return sum + bar.width + gap;
        }, 0);

        let cursor = -totalWidth / 2;
        state.bars.forEach((bar, index) => {
            cursor += bar.width / 2;
            bar.x = cursor;
            cursor += bar.width / 2;
            if (index < state.bars.length - 1) {
                cursor += bar.gapAfter;
            }
        });
    }

    function getSelectedBar() {
        return state.bars.find((bar) => bar.id === state.selectedBarId) ?? null;
    }

    function getSelectedBarIndex() {
        return state.bars.findIndex((bar) => bar.id === state.selectedBarId);
    }

    function getTaskTotals(bar) {
        const totalCount = bar.tasks.length;
        const doneCount = bar.tasks.filter((task) => task.done).length;

        return {
            totalCount,
            doneCount,
        };
    }

    function getBarProgress(bar) {
        const totals = getTaskTotals(bar);
        if (totals.totalCount === 0) return 0;
        return clamp(totals.doneCount / totals.totalCount, 0, 1);
    }

    function getGaugeGeometry(bar) {
        const left = bar.x - bar.width / 2;
        const top = -bar.height / 2;

        return {
            left,
            top,
            width: bar.width,
            height: bar.height,
            bottom: top + bar.height,
        };
    }

    function hexToRgb(hex) {
        const normalized = normalizeColor(hex).slice(1);
        return {
            r: parseInt(normalized.slice(0, 2), 16),
            g: parseInt(normalized.slice(2, 4), 16),
            b: parseInt(normalized.slice(4, 6), 16),
        };
    }

    function toPastelColor(hex) {
        const { r, g, b } = hexToRgb(hex);
        const brightness = (r + g + b) / 3;

        if (brightness < 28) {
            return "rgb(116, 116, 116)";
        }

        const mix = 0.62;
        const pastel = {
            r: Math.round(r + (255 - r) * mix),
            g: Math.round(g + (255 - g) * mix),
            b: Math.round(b + (255 - b) * mix),
        };

        return `rgb(${pastel.r}, ${pastel.g}, ${pastel.b})`;
    }

    function pastelTone(hex) {
        const color = toPastelColor(hex);
        const match = color.match(/\d+/g);
        if (!match) return { text: color, border: "rgba(0, 0, 0, 0.12)", background: "rgba(255, 255, 255, 0.78)" };

        const [r, g, b] = match.map(Number);
        return {
            text: `rgb(${Math.max(58, r - 38)}, ${Math.max(58, g - 38)}, ${Math.max(58, b - 38)})`,
            border: `rgba(${r}, ${g}, ${b}, 0.5)`,
            background: `rgba(${r}, ${g}, ${b}, 0.16)`,
        };
    }

    function getWorldBounds() {
        if (state.bars.length === 0) {
            return { left: -120, right: 120, top: -180, bottom: 180 };
        }

        const bounds = {
            left: Infinity,
            right: -Infinity,
            top: Infinity,
            bottom: -Infinity,
        };

        state.bars.forEach((bar) => {
            bounds.left = Math.min(bounds.left, bar.x - bar.width / 2);
            bounds.right = Math.max(bounds.right, bar.x + bar.width / 2);
            bounds.top = Math.min(bounds.top, -bar.height / 2);
            bounds.bottom = Math.max(bounds.bottom, bar.height / 2);
        });

        return {
            left: bounds.left - 90,
            right: bounds.right + 90,
            top: bounds.top - 80,
            bottom: bounds.bottom + 86,
        };
    }

    function fitView() {
        const bounds = getWorldBounds();
        const width = bounds.right - bounds.left;
        const height = bounds.bottom - bounds.top;
        const nextZoom = clamp(
            Math.min(
                (state.canvasSize.width - 80) / Math.max(width, 1),
                (state.canvasSize.height - 80) / Math.max(height, 1),
            ),
            0.5,
            1.6,
        );

        state.camera.zoom = nextZoom;
        state.camera.x = state.canvasSize.width / 2 - ((bounds.left + bounds.right) / 2) * nextZoom;
        state.camera.y = state.canvasSize.height / 2 - ((bounds.top + bounds.bottom) / 2) * nextZoom;
        updateZoomLabel();
        requestRender();
    }

    function focusBar(bar) {
        if (!bar) return;
        state.camera.x = state.canvasSize.width * 0.45 - bar.x * state.camera.zoom;
        state.camera.y = state.canvasSize.height / 2;
        requestRender();
    }

    function resizeCanvas() {
        const rect = canvas.getBoundingClientRect();
        const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
        const previousWidth = state.canvasSize.width;
        const previousHeight = state.canvasSize.height;

        state.canvasSize.width = rect.width;
        state.canvasSize.height = rect.height;
        state.canvasSize.dpr = dpr;
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);

        const sizeChanged = previousWidth > 0 && previousHeight > 0;
        const widthShift = sizeChanged ? Math.abs(rect.width - previousWidth) / previousWidth : 0;
        const heightShift = sizeChanged ? Math.abs(rect.height - previousHeight) / previousHeight : 0;
        const shouldRefit = !state.didFit || widthShift > 0.28 || heightShift > 0.28;

        if (shouldRefit && rect.width > 0 && rect.height > 0) {
            fitView();
            state.didFit = true;
        }

        requestRender();
    }

    function requestRender() {
        state.renderRequested = true;
    }

    function clearCanvas() {
        const { width, height, dpr } = state.canvasSize;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
    }

    function setWorldTransform() {
        const { dpr } = state.canvasSize;
        const { x, y, zoom } = state.camera;
        ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * x, dpr * y);
    }

    function drawBackgroundMarks() {
        const { width, height, dpr } = state.canvasSize;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.save();
        ctx.fillStyle = "rgba(23, 25, 29, 0.12)";
        for (let x = 36; x < width; x += 88) {
            for (let y = 36; y < height; y += 88) {
                ctx.beginPath();
                ctx.arc(x, y, 1.1, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.restore();
    }

    function drawGaugeInsideBar(bar, progress) {
        if (bar.tasks.length === 0 || progress <= 0) return false;

        const gauge = getGaugeGeometry(bar);
        const fillHeight = gauge.height * progress;
        const waveBaseY = gauge.bottom - fillHeight;
        const elapsed = state.reduceMotion ? 0 : performance.now() * 0.001;
        const amplitude = Math.min(7, Math.max(1.8, bar.width * 0.22)) / state.camera.zoom;
        const step = Math.max(1.2 / state.camera.zoom, bar.width / 18);
        const phase = elapsed * 1.55 + bar.x * 0.021;
        const waveYAt = (x) => {
            const local = x - gauge.left;
            const softWave = Math.sin(local * 0.12 + phase) * amplitude;
            const smallRipple = Math.sin(local * 0.31 - elapsed * 1.9 + bar.height * 0.01) * amplitude * 0.32;
            const longDrift = Math.sin(elapsed * 0.7 + bar.id.length) * amplitude * 0.2;
            return clamp(waveBaseY + softWave + smallRipple + longDrift, gauge.top, gauge.bottom);
        };
        const firstWaveY = waveYAt(gauge.left);

        ctx.save();
        ctx.beginPath();
        ctx.rect(gauge.left, gauge.top, gauge.width, gauge.height);
        ctx.clip();

        ctx.fillStyle = toPastelColor(bar.color);
        ctx.beginPath();
        ctx.moveTo(gauge.left, gauge.bottom);
        ctx.lineTo(gauge.left, firstWaveY);

        for (let x = gauge.left + step; x < gauge.left + gauge.width; x += step) {
            ctx.lineTo(x, waveYAt(x));
        }
        ctx.lineTo(gauge.left + gauge.width, waveYAt(gauge.left + gauge.width));

        ctx.lineTo(gauge.left + gauge.width, gauge.bottom);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
        return !state.reduceMotion && (progress < 1 || progress > 0);
    }

    function drawBars() {
        let needsAnimation = false;

        state.bars.forEach((bar) => {
            const isSelected = bar.id === state.selectedBarId;
            const top = -bar.height / 2;
            const bottom = bar.height / 2;
            const targetProgress = getBarProgress(bar);
            const diff = targetProgress - bar.displayProgress;

            if (Math.abs(diff) > 0.003) {
                bar.displayProgress += diff * 0.18;
                needsAnimation = true;
            } else {
                bar.displayProgress = targetProgress;
            }

            ctx.save();
            ctx.fillStyle = bar.color;
            ctx.fillRect(bar.x - bar.width / 2, top, bar.width, bar.height);

            needsAnimation = drawGaugeInsideBar(bar, bar.displayProgress) || needsAnimation;

            if (isSelected) {
                const selectedTone = pastelTone(bar.color);
                ctx.strokeStyle = selectedTone.text;
                ctx.lineWidth = 3.2 / state.camera.zoom;
                ctx.strokeRect(
                    bar.x - bar.width / 2 - 4 / state.camera.zoom,
                    top - 4 / state.camera.zoom,
                    bar.width + 8 / state.camera.zoom,
                    bar.height + 8 / state.camera.zoom,
                );
            }

            if (state.revealed && bar.tasks.length > 0) {
                ctx.fillStyle = "rgba(23, 25, 29, 0.56)";
                ctx.font = `700 ${10 / state.camera.zoom}px sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "top";
                ctx.fillText(`${Math.round(targetProgress * 100)}%`, bar.x, bottom + 10 / state.camera.zoom);
            }

            ctx.restore();
        });

        return needsAnimation;
    }

    function drawReveal() {
        if (!state.revealed) return;

        const bounds = getWorldBounds();
        const now = state.reduceMotion ? 0 : performance.now();
        const frame = {
            left: bounds.left + 24,
            top: bounds.top + 24,
            width: bounds.right - bounds.left - 48,
            height: bounds.bottom - bounds.top - 48,
        };
        const innerFrame = {
            left: frame.left + 9 / state.camera.zoom,
            top: frame.top + 9 / state.camera.zoom,
            width: frame.width - 18 / state.camera.zoom,
            height: frame.height - 18 / state.camera.zoom,
        };
        const label = "My Barcode ID";
        const labelFontSize = 17 / state.camera.zoom;
        const labelPaddingX = 11 / state.camera.zoom;
        const labelPaddingY = 6 / state.camera.zoom;
        const labelY = innerFrame.top + 11 / state.camera.zoom;

        ctx.save();
        ctx.strokeStyle = "rgba(25, 143, 101, 0.64)";
        ctx.lineWidth = 2.4 / state.camera.zoom;
        ctx.setLineDash([12 / state.camera.zoom, 13 / state.camera.zoom]);
        ctx.lineDashOffset = -(now * 0.036) / state.camera.zoom;
        ctx.strokeRect(innerFrame.left, innerFrame.top, innerFrame.width, innerFrame.height);
        ctx.setLineDash([]);

        ctx.font = `900 ${labelFontSize}px sans-serif`;
        const labelWidth = ctx.measureText(label).width;
        const labelBox = {
            left: innerFrame.left + innerFrame.width / 2 - labelWidth / 2 - labelPaddingX,
            top: labelY - labelPaddingY,
            width: labelWidth + labelPaddingX * 2,
            height: labelFontSize + labelPaddingY * 2,
        };

        labelBox.left = clamp(labelBox.left, innerFrame.left + 8 / state.camera.zoom, innerFrame.left + innerFrame.width - labelBox.width - 8 / state.camera.zoom);
        labelBox.top = clamp(labelBox.top, innerFrame.top + 8 / state.camera.zoom, innerFrame.top + innerFrame.height - labelBox.height - 8 / state.camera.zoom);

        ctx.fillStyle = "rgba(244, 246, 248, 0.96)";
        ctx.fillRect(labelBox.left, labelBox.top, labelBox.width, labelBox.height);
        ctx.strokeStyle = "rgba(25, 143, 101, 0.34)";
        ctx.lineWidth = 1 / state.camera.zoom;
        ctx.strokeRect(labelBox.left, labelBox.top, labelBox.width, labelBox.height);

        ctx.fillStyle = "rgba(25, 143, 101, 0.92)";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(label, labelBox.left + labelBox.width / 2, labelBox.top + labelPaddingY);
        ctx.restore();
    }

    function render() {
        clearCanvas();
        drawBackgroundMarks();
        setWorldTransform();
        const needsAnimation = drawBars();
        drawReveal();
        return needsAnimation;
    }

    function screenToWorld(point) {
        return {
            x: (point.x - state.camera.x) / state.camera.zoom,
            y: (point.y - state.camera.y) / state.camera.zoom,
        };
    }

    function getCanvasPoint(event) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
        };
    }

    function updateMousePoint(event) {
        const point = getCanvasPoint(event);
        state.mouse.x = point.x;
        state.mouse.y = point.y;
        state.mouse.inside = true;
        return point;
    }

    function hitTest(worldPoint) {
        const tolerance = 10 / state.camera.zoom;

        for (let index = state.bars.length - 1; index >= 0; index -= 1) {
            const bar = state.bars[index];
            const gauge = getGaugeGeometry(bar);
            const barLeft = bar.x - bar.width / 2 - tolerance;
            const barRight = Math.max(bar.x + bar.width / 2, gauge.left + gauge.width) + tolerance;

            if (
                worldPoint.x >= barLeft &&
                worldPoint.x <= barRight &&
                worldPoint.y >= -bar.height / 2 - tolerance &&
                worldPoint.y <= bar.height / 2 + tolerance
            ) {
                return { type: "bar", barId: bar.id };
            }
        }

        return null;
    }

    function selectHit(hit) {
        if (!hit) {
            state.selectedBarId = null;
            state.selectedTaskId = null;
            renderPanel();
            requestRender();
            saveState();
            return;
        }

        state.selectedBarId = hit.barId;
        state.selectedTaskId = null;
        renderPanel();
        requestRender();
        saveState();
    }

    function getZoomAnchor() {
        if (state.mouse.inside && state.mouse.x !== null && state.mouse.y !== null) {
            return { x: state.mouse.x, y: state.mouse.y };
        }

        return {
            x: state.canvasSize.width / 2,
            y: state.canvasSize.height / 2,
        };
    }

    function zoomAt(screenX, screenY, factor) {
        const before = screenToWorld({ x: screenX, y: screenY });
        state.camera.zoom = clamp(state.camera.zoom * factor, MIN_ZOOM, MAX_ZOOM);
        state.camera.x = screenX - before.x * state.camera.zoom;
        state.camera.y = screenY - before.y * state.camera.zoom;
        updateZoomLabel();
        requestRender();
    }

    function updateZoomLabel() {
        const zoomPercent = `${Math.round(state.camera.zoom * 100)}%`;
        resetViewBtn.textContent = zoomPercent;
        resetViewBtn.setAttribute("aria-label", `보기 초기화, 현재 ${zoomPercent}`);
    }

    function handleCanvasKeydown(event) {
        const panStep = event.shiftKey ? 72 : 32;
        let handled = true;

        switch (event.key) {
            case "ArrowUp":
                state.camera.y += panStep;
                break;
            case "ArrowDown":
                state.camera.y -= panStep;
                break;
            case "ArrowLeft":
                state.camera.x += panStep;
                break;
            case "ArrowRight":
                state.camera.x -= panStep;
                break;
            case "+":
            case "=":
                zoomAt(state.canvasSize.width / 2, state.canvasSize.height / 2, 1.18);
                break;
            case "-":
            case "_":
                zoomAt(state.canvasSize.width / 2, state.canvasSize.height / 2, 0.84);
                break;
            case "0":
            case "Home":
                fitView();
                break;
            case "Escape":
                selectHit(null);
                break;
            default:
                handled = false;
        }

        if (!handled) return;

        event.preventDefault();
        requestRender();
    }

    function syncRevealState() {
        revealPanel.hidden = !state.revealed;
        revealBtn.classList.toggle("is-active", state.revealed);
        revealBtn.setAttribute("aria-pressed", String(state.revealed));
        revealBtn.textContent = state.revealed ? "숨김" : "스캔";
    }

    function showToast(message) {
        toast.textContent = message;
        toast.classList.add("is-visible");
        window.clearTimeout(state.toastTimer);
        state.toastTimer = window.setTimeout(() => {
            toast.classList.remove("is-visible");
        }, 1800);
    }

    function autoResizeTextarea(textarea) {
        textarea.style.height = "auto";
        textarea.style.height = `${textarea.scrollHeight}px`;
    }

    function updateBrandStatus(bar) {
        if (!bar) {
            brandStatus.textContent = "ID-in-Lines";
            brandStatus.setAttribute("aria-label", "ID-in-Lines 상태, 선택된 선 없음");
            brandStatus.style.color = "";
            brandStatus.style.borderColor = "";
            brandStatus.style.background = "";
            return;
        }

        const totals = getTaskTotals(bar);
        const tone = pastelTone(bar.color);
        brandStatus.textContent = `${bar.title} · ${totals.doneCount}/${totals.totalCount}`;
        brandStatus.setAttribute("aria-label", `${bar.title}, 완료한 계획 ${totals.doneCount}개, 전체 계획 ${totals.totalCount}개`);
        brandStatus.style.color = "#17191d";
        brandStatus.style.borderColor = tone.border;
        brandStatus.style.background = tone.background;
    }

    function updateRangeValueText() {
        barWidthInput.setAttribute("aria-valuetext", `${barWidthInput.value}px`);
        barHeightInput.setAttribute("aria-valuetext", `${barHeightInput.value}px`);
    }

    function renderPanel() {
        const bar = getSelectedBar();
        const hasBar = Boolean(bar);
        const controls = [
            barTitleInput,
            barWidthInput,
            barHeightInput,
            barColorInput,
            moveBarLeftBtn,
            moveBarRightBtn,
            resetBarBtn,
            deleteBarBtn,
            planTextInput,
            addTaskBtn,
        ];

        controls.forEach((control) => {
            control.disabled = !hasBar;
        });

        if (!bar) {
            selectedLabel.textContent = "--";
            selectedLabel.setAttribute("aria-label", "선택된 선 없음");
            barTitleInput.value = "";
            barWidthInput.value = "12";
            barHeightInput.value = "260";
            updateRangeValueText();
            barColorInput.value = DEFAULT_COLOR;
            planTextInput.value = "";
            autoResizeTextarea(planTextInput);
            planCount.textContent = "0/0";
            planCount.setAttribute("aria-label", "완료한 계획 0개, 전체 계획 0개");
            setTaskListMode(false);
            taskList.innerHTML = '<div class="empty-state">선을 먼저 선택하세요.</div>';
            updateBrandStatus(null);
            return;
        }

        const barIndex = getSelectedBarIndex();
        selectedLabel.textContent = bar.title;
        selectedLabel.setAttribute("aria-label", `선택된 선 ${bar.title}`);
        barTitleInput.value = bar.title;
        barWidthInput.value = String(bar.width);
        barHeightInput.value = String(bar.height);
        updateRangeValueText();
        barColorInput.value = normalizeColor(bar.color);
        moveBarLeftBtn.disabled = barIndex <= 0;
        moveBarRightBtn.disabled = barIndex >= state.bars.length - 1;
        updatePlanSummary(bar);
        updateBrandStatus(bar);
        renderTaskList(bar);
    }

    function updatePlanSummary(bar) {
        const totals = getTaskTotals(bar);
        planCount.textContent = `${totals.doneCount}/${totals.totalCount}`;
        planCount.setAttribute("aria-label", `완료한 계획 ${totals.doneCount}개, 전체 계획 ${totals.totalCount}개`);
        updateBrandStatus(bar);
    }

    function setTaskListMode(hasTasks) {
        if (hasTasks) {
            taskList.setAttribute("role", "list");
            taskList.setAttribute("aria-label", "계획 목록");
            return;
        }

        taskList.setAttribute("role", "status");
        taskList.setAttribute("aria-label", "계획 목록 상태");
    }

    function renderTaskList(bar) {
        taskList.innerHTML = "";

        if (bar.tasks.length === 0) {
            setTaskListMode(false);
            const empty = document.createElement("div");
            empty.className = "empty-state";
            empty.textContent = "추가된 계획이 없습니다.";
            taskList.appendChild(empty);
            return;
        }

        setTaskListMode(true);
        bar.tasks.forEach((task, index) => {
            const taskOrderLabel = `No. ${String(index + 1).padStart(2, "0")}`;
            const getTaskControlLabel = () => {
                const compactText = task.text.replace(/\s+/g, " ").trim();
                const taskTextLabel = compactText.length > 36 ? `${compactText.slice(0, 36)}...` : compactText;
                return `${taskOrderLabel}, ${taskTextLabel || "빈 계획"}`;
            };
            const item = document.createElement("div");
            item.className = "task-item";
            item.draggable = true;
            item.dataset.taskId = task.id;
            item.setAttribute("role", "listitem");
            if (task.id === state.selectedTaskId) {
                item.classList.add("is-selected");
            }

            const checkbox = document.createElement("input");
            checkbox.className = "task-check";
            checkbox.type = "checkbox";
            checkbox.checked = task.done;

            const body = document.createElement("div");
            body.className = "task-body";

            const meta = document.createElement("div");
            meta.className = "task-meta";

            const lineBadge = document.createElement("span");
            lineBadge.className = "line-badge";
            lineBadge.textContent = bar.title;

            const order = document.createElement("span");
            order.className = "task-order";
            order.textContent = taskOrderLabel;

            const input = document.createElement("textarea");
            input.rows = 1;
            input.maxLength = 160;
            input.value = task.text;
            input.readOnly = true;

            const reorderControls = document.createElement("div");
            reorderControls.className = "task-reorder";

            const moveUpBtn = document.createElement("button");
            moveUpBtn.className = "task-move-btn";
            moveUpBtn.type = "button";
            moveUpBtn.title = "위로 이동";
            moveUpBtn.textContent = "▲";
            moveUpBtn.disabled = index === 0;

            const moveDownBtn = document.createElement("button");
            moveDownBtn.className = "task-move-btn";
            moveDownBtn.type = "button";
            moveDownBtn.title = "아래로 이동";
            moveDownBtn.textContent = "▼";
            moveDownBtn.disabled = index === bar.tasks.length - 1;

            const editBtn = document.createElement("button");
            editBtn.className = "edit-btn";
            editBtn.type = "button";
            editBtn.title = "계획 수정";
            editBtn.textContent = "수정";

            const deleteBtn = document.createElement("button");
            deleteBtn.className = "mini-btn";
            deleteBtn.type = "button";
            deleteBtn.title = "계획 삭제";
            deleteBtn.textContent = "×";

            const syncTaskControlLabels = () => {
                const taskControlLabel = getTaskControlLabel();
                checkbox.setAttribute("aria-label", `${taskControlLabel} 완료 여부`);
                input.setAttribute("aria-label", `${taskControlLabel} 내용`);
                moveUpBtn.setAttribute("aria-label", `${taskControlLabel} 위로 이동`);
                moveDownBtn.setAttribute("aria-label", `${taskControlLabel} 아래로 이동`);
                editBtn.setAttribute("aria-label", `${taskControlLabel} 수정`);
                deleteBtn.setAttribute("aria-label", `${taskControlLabel} 삭제`);
            };
            syncTaskControlLabels();

            checkbox.addEventListener("change", () => {
                task.done = checkbox.checked;
                state.selectedTaskId = task.id;
                highlightTaskItem(task.id);
                updatePlanSummary(bar);
                requestRender();
                saveState();
            });

            input.addEventListener("focus", () => {
                if (input.readOnly) {
                    input.blur();
                    return;
                }

                state.selectedTaskId = task.id;
                highlightTaskItem(task.id);
                requestRender();
                saveState();
            });

            input.addEventListener("input", () => {
                task.text = input.value;
                autoResizeTextarea(input);
                syncTaskControlLabels();
                updatePlanSummary(bar);
                requestRender();
                saveState();
            });

            input.addEventListener("keydown", (event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    input.readOnly = true;
                    editBtn.classList.remove("is-editing");
                    editBtn.textContent = "수정";
                    input.blur();
                }
            });

            moveUpBtn.addEventListener("click", () => {
                moveTaskByOffset(bar, task.id, -1);
            });

            moveDownBtn.addEventListener("click", () => {
                moveTaskByOffset(bar, task.id, 1);
            });

            editBtn.addEventListener("click", () => {
                const nextEditing = input.readOnly;
                input.readOnly = !nextEditing;
                editBtn.classList.toggle("is-editing", nextEditing);
                editBtn.textContent = nextEditing ? "완료" : "수정";

                if (nextEditing) {
                    state.selectedTaskId = task.id;
                    highlightTaskItem(task.id);
                    input.focus();
                    input.setSelectionRange(input.value.length, input.value.length);
                } else {
                    saveState();
                }
            });

            deleteBtn.addEventListener("click", () => {
                deleteTask(task.id);
            });

            item.addEventListener("dragstart", (event) => {
                if (event.target.closest("button, input, textarea")) {
                    event.preventDefault();
                    return;
                }

                state.selectedTaskId = task.id;
                item.classList.add("is-dragging");
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", task.id);
                highlightTaskItem(task.id);
            });

            item.addEventListener("dragend", () => {
                item.classList.remove("is-dragging");
                taskList.querySelectorAll(".task-item").forEach((taskItem) => {
                    taskItem.classList.remove("is-drop-target");
                });
            });

            item.addEventListener("dragover", (event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                taskList.querySelectorAll(".task-item").forEach((taskItem) => {
                    taskItem.classList.toggle("is-drop-target", taskItem === item);
                });
            });

            item.addEventListener("dragleave", () => {
                item.classList.remove("is-drop-target");
            });

            item.addEventListener("drop", (event) => {
                event.preventDefault();
                const draggedTaskId = event.dataTransfer.getData("text/plain");
                reorderTask(bar, draggedTaskId, task.id);
            });

            item.addEventListener("click", () => {
                state.selectedTaskId = task.id;
                highlightTaskItem(task.id);
                requestRender();
                saveState();
            });

            meta.append(lineBadge, order);
            body.append(meta, input);
            reorderControls.append(moveUpBtn, moveDownBtn);
            item.append(checkbox, body, reorderControls, editBtn, deleteBtn);
            taskList.appendChild(item);
            autoResizeTextarea(input);
        });
    }

    function highlightTaskItem(taskId) {
        taskList.querySelectorAll(".task-item").forEach((item) => {
            item.classList.toggle("is-selected", item.dataset.taskId === taskId);
        });
    }

    function normalizeColor(value) {
        if (/^#[0-9a-f]{6}$/i.test(value)) {
            return value;
        }
        return DEFAULT_COLOR;
    }

    function addBar() {
        const bar = makeBar(randomInt(5, 32), randomInt(180, 450), randomInt(8, 24));
        state.bars.push(bar);
        renumberBars();
        layoutBars();
        state.selectedBarId = bar.id;
        state.selectedTaskId = null;
        renderPanel();
        focusBar(bar);
        saveState();
    }

    function resetSelectedBar() {
        const bar = getSelectedBar();
        if (!bar) return;

        bar.color = DEFAULT_COLOR;
        bar.tasks = [];
        bar.displayProgress = 0;
        state.selectedTaskId = null;
        renderPanel();
        requestRender();
        saveState();
        showToast("선이 초기화되었습니다.");
    }

    function deleteSelectedBar() {
        const bar = getSelectedBar();
        if (!bar) return;

        const index = getSelectedBarIndex();
        state.bars.splice(index, 1);
        renumberBars();
        layoutBars();

        const next = state.bars[index] ?? state.bars[index - 1] ?? null;
        state.selectedBarId = next?.id ?? null;
        state.selectedTaskId = null;
        renderPanel();
        requestRender();
        saveState();
        showToast("선이 삭제되었습니다.");
    }

    function moveSelectedBar(direction) {
        const index = getSelectedBarIndex();
        const nextIndex = index + direction;

        if (index < 0 || nextIndex < 0 || nextIndex >= state.bars.length) return;

        const bar = state.bars[index];
        const beforeX = bar.x;
        state.bars.splice(index, 1);
        state.bars.splice(nextIndex, 0, bar);
        renumberBars();
        layoutBars();
        state.camera.x += (beforeX - bar.x) * state.camera.zoom;
        renderPanel();
        requestRender();
        saveState();
    }

    function addTask() {
        const bar = getSelectedBar();
        const text = planTextInput.value.trim();

        if (!bar) {
            showToast("선을 먼저 선택하세요.");
            return;
        }

        if (!text) {
            showToast("계획 내용을 입력하세요.");
            return;
        }

        const task = {
            id: nextId("task"),
            text,
            done: false,
        };
        const shouldRefocusPlanInput = document.activeElement === planTextInput || document.activeElement === addTaskBtn;

        bar.tasks.push(task);
        state.selectedTaskId = task.id;
        planTextInput.value = "";
        autoResizeTextarea(planTextInput);
        renderPanel();
        if (shouldRefocusPlanInput) {
            planTextInput.focus();
        }
        requestRender();
        saveState();
    }

    function deleteTask(taskId) {
        const bar = getSelectedBar();
        if (!bar) return;

        bar.tasks = bar.tasks.filter((task) => task.id !== taskId);
        if (state.selectedTaskId === taskId) {
            state.selectedTaskId = null;
        }

        renderPanel();
        requestRender();
        saveState();
        showToast("계획이 삭제되었습니다.");
    }

    function reorderTask(bar, draggedTaskId, targetTaskId) {
        if (!bar || !draggedTaskId || !targetTaskId || draggedTaskId === targetTaskId) return;

        const fromIndex = bar.tasks.findIndex((task) => task.id === draggedTaskId);
        const toIndex = bar.tasks.findIndex((task) => task.id === targetTaskId);
        if (fromIndex < 0 || toIndex < 0) return;

        const [draggedTask] = bar.tasks.splice(fromIndex, 1);
        bar.tasks.splice(toIndex, 0, draggedTask);
        state.selectedTaskId = draggedTask.id;
        renderTaskList(bar);
        requestRender();
        saveState();
    }

    function moveTaskByOffset(bar, taskId, offset) {
        if (!bar || !taskId || offset === 0) return;

        const fromIndex = bar.tasks.findIndex((task) => task.id === taskId);
        const toIndex = fromIndex + offset;
        if (fromIndex < 0 || toIndex < 0 || toIndex >= bar.tasks.length) return;

        const [task] = bar.tasks.splice(fromIndex, 1);
        bar.tasks.splice(toIndex, 0, task);
        state.selectedTaskId = task.id;
        renderTaskList(bar);
        requestRender();
        saveState();
    }

    function updateSelectedBarSize(property, value) {
        const bar = getSelectedBar();
        if (!bar) return;

        const beforeX = bar.x;
        bar[property] = value;
        layoutBars();
        state.camera.x += (beforeX - bar.x) * state.camera.zoom;
        requestRender();
        saveState();
    }

    function updateSelectedBarColor(value) {
        const bar = getSelectedBar();
        if (!bar) return;

        bar.color = value;
        updateBrandStatus(bar);
        requestRender();
        saveState();
    }

    function updateSelectedBarTitle(value) {
        const bar = getSelectedBar();
        if (!bar) return;

        const fallbackTitle = `Line${String(getSelectedBarIndex() + 1).padStart(2, "0")}`;
        const nextTitle = value.trim();
        bar.title = nextTitle || fallbackTitle;
        bar.customTitle = Boolean(nextTitle);
        selectedLabel.textContent = bar.title;
        selectedLabel.setAttribute("aria-label", `선택된 선 ${bar.title}`);
        updateBrandStatus(bar);
        renderTaskList(bar);
        saveState();
    }

    function bindEvents() {
        window.addEventListener("resize", resizeCanvas);
        motionQuery.addEventListener("change", (event) => {
            state.reduceMotion = event.matches;
            requestRender();
        });

        canvas.addEventListener("pointerenter", (event) => {
            updateMousePoint(event);
        });

        canvas.addEventListener("pointerleave", () => {
            if (!state.pointer.active) {
                state.mouse.inside = false;
            }
        });

        canvas.addEventListener("pointerdown", (event) => {
            if (event.button !== 0) return;
            const point = updateMousePoint(event);
            state.pointer.active = true;
            state.pointer.moved = false;
            state.pointer.startX = point.x;
            state.pointer.startY = point.y;
            state.pointer.lastX = point.x;
            state.pointer.lastY = point.y;
            canvas.classList.add("is-dragging");
            canvas.setPointerCapture(event.pointerId);
        });

        canvas.addEventListener("pointermove", (event) => {
            const point = updateMousePoint(event);
            if (!state.pointer.active) return;

            const dx = point.x - state.pointer.lastX;
            const dy = point.y - state.pointer.lastY;
            const totalDx = point.x - state.pointer.startX;
            const totalDy = point.y - state.pointer.startY;

            if (Math.hypot(totalDx, totalDy) > 3) {
                state.pointer.moved = true;
            }

            state.camera.x += dx;
            state.camera.y += dy;
            state.pointer.lastX = point.x;
            state.pointer.lastY = point.y;
            requestRender();
        });

        canvas.addEventListener("pointerup", (event) => {
            const point = updateMousePoint(event);
            canvas.classList.remove("is-dragging");
            state.pointer.active = false;
            canvas.releasePointerCapture(event.pointerId);

            if (!state.pointer.moved) {
                const hit = hitTest(screenToWorld(point));
                selectHit(hit);
            }
        });

        canvas.addEventListener("pointercancel", () => {
            state.pointer.active = false;
            canvas.classList.remove("is-dragging");
        });

        canvas.addEventListener("wheel", (event) => {
            event.preventDefault();
            const point = updateMousePoint(event);
            const factor = Math.exp(-event.deltaY * 0.001);
            zoomAt(point.x, point.y, factor);
        }, { passive: false });

        canvas.addEventListener("keydown", handleCanvasKeydown);

        zoomOutBtn.addEventListener("click", () => {
            const anchor = getZoomAnchor();
            zoomAt(anchor.x, anchor.y, 0.84);
        });

        zoomInBtn.addEventListener("click", () => {
            const anchor = getZoomAnchor();
            zoomAt(anchor.x, anchor.y, 1.18);
        });

        resetViewBtn.addEventListener("click", fitView);
        addBarBtn.addEventListener("click", addBar);
        moveBarLeftBtn.addEventListener("click", () => moveSelectedBar(-1));
        moveBarRightBtn.addEventListener("click", () => moveSelectedBar(1));
        resetBarBtn.addEventListener("click", resetSelectedBar);
        deleteBarBtn.addEventListener("click", deleteSelectedBar);
        addTaskBtn.addEventListener("click", addTask);

        revealBtn.addEventListener("click", () => {
            state.revealed = !state.revealed;
            syncRevealState();
            requestRender();
            saveState();
        });

        barTitleInput.addEventListener("input", () => {
            updateSelectedBarTitle(barTitleInput.value);
        });

        barWidthInput.addEventListener("input", () => {
            updateRangeValueText();
            updateSelectedBarSize("width", Number(barWidthInput.value));
        });

        barHeightInput.addEventListener("input", () => {
            updateRangeValueText();
            updateSelectedBarSize("height", Number(barHeightInput.value));
        });

        barColorInput.addEventListener("input", () => {
            updateSelectedBarColor(barColorInput.value);
        });

        planTextInput.addEventListener("keydown", (event) => {
            if (event.isComposing) return;
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                addTask();
            }
        });

        planTextInput.addEventListener("input", () => {
            autoResizeTextarea(planTextInput);
        });
    }

    function animationLoop() {
        const revealIsAnimating = state.revealed && !state.reduceMotion;
        if (state.renderRequested || revealIsAnimating || state.progressAnimating) {
            state.progressAnimating = render();
            state.renderRequested = false;
        }
        window.requestAnimationFrame(animationLoop);
    }

    if (!loadState()) {
        createInitialBars();
    }
    bindEvents();
    resizeCanvas();
    renderPanel();
    syncRevealState();
    updateZoomLabel();
    animationLoop();
})();
