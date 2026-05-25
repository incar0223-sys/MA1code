/**
 * 튜토리얼 모드 — CSV 미사용, tutorial.json + 기존 인사일정 JSON만 사용
 */
(function(global) {
    'use strict';

    var config = null;
    var configPromise = null;
    var active = false;
    var DEFAULT_RESULT_HINT = '사번을 검색 후 보험사를 조회하세요 / 📅 버튼을 눌러 상세 인사일정을 확인하세요.';
    var stepIndex = 0;
    var demoRows = [];
    var overlayEl = null;
    var popoverEl = null;
    var spotHoleEl = null;
    var backdropEl = null;
    var elevatedEl = null;
    var focusEl = null;
    var readmeOpen = false;
    var scheduleCloseHooked = false;

    function pad2(n) {
        n = parseInt(n, 10) || 0;
        return (n < 10 ? '0' : '') + n;
    }

    function labelToDate(label) {
        var m = String(label || '').match(/(\d{4})년\s*(\d{1,2})월/);
        if (!m) return null;
        return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, 1);
    }

    function monthLabelText() {
        if (typeof scheduleMonth !== 'undefined' && scheduleMonth) {
            return scheduleMonth + ' 기준';
        }
        if (typeof monthLabels !== 'undefined' && monthLabels.length && typeof closestMonthIdx === 'function') {
            return (monthLabels[closestMonthIdx()] || '') + ' 기준';
        }
        return '현재 월 기준';
    }

    function scheduleMonthNumber() {
        if (typeof monthLabels !== 'undefined' && monthLabels.length && typeof closestMonthIdx === 'function') {
            var d = labelToDate(monthLabels[closestMonthIdx()]);
            if (d) return d.getMonth() + 1;
        }
        return new Date().getMonth() + 1;
    }

    function pickRoundForCompany(sd, company) {
        if (!sd) return 1;
        var prefix = typeof scheduleLookupPrefix === 'function'
            ? scheduleLookupPrefix(company)
            : company;
        var best = 0;
        Object.keys(sd).forEach(function(key) {
            var m = key.match(/^(.+)_(\d+)차$/);
            if (!m) return;
            if (m[1] !== prefix && m[1] !== company) return;
            var round = parseInt(m[2], 10);
            var row = sd[key];
            var fa = row && String(row['서류마감FA'] || '').trim();
            if (!fa) return;
            if (round > best) best = round;
        });
        return best >= 1 ? best : 1;
    }

    function ensureConfig() {
        if (config) return Promise.resolve(config);
        if (configPromise) return configPromise;
        configPromise = fetch('tutorial.json?v=' + Date.now())
            .then(function(res) {
                if (!res.ok) throw new Error('tutorial.json을 불러올 수 없습니다.');
                return res.json();
            })
            .then(function(json) {
                config = json;
                return config;
            })
            .catch(function(err) {
                configPromise = null;
                throw err;
            });
        return configPromise;
    }

    function isDemoSabun(val) {
        if (!config || !config.demo || !config.demo.sabun) return false;
        return String(val).trim().toLowerCase() === String(config.demo.sabun).trim().toLowerCase();
    }

    function getCompanyFilterQuery() {
        var el = document.getElementById('companyFilterInput');
        return el ? el.value.trim().toLowerCase() : '';
    }

    function filterDemoRowsForCompany(rows) {
        var coQ = getCompanyFilterQuery();
        if (!coQ) return rows;
        var fmtCo = typeof formatCompanyDisplayName === 'function'
            ? formatCompanyDisplayName
            : function(c) { return c; };
        return rows.filter(function(row) {
            var raw = String(row.company || '').toLowerCase();
            var disp = String(fmtCo(row.company || '')).toLowerCase();
            return raw.indexOf(coQ) >= 0 || disp.indexOf(coQ) >= 0;
        });
    }

    function setDemoResultHint(on) {
        var hint = document.getElementById('resultInfoHint');
        if (!hint) return;
        if (on && config && config.demo) {
            hint.textContent = config.demo.disclaimer || '※ 안내용 예시입니다.';
            hint.classList.remove('is-off');
            return;
        }
        hint.textContent = DEFAULT_RESULT_HINT;
    }

    function buildDemoRows() {
        if (!config || !config.demo) return [];
        var idx = typeof closestMonthIdx === 'function' ? closestMonthIdx() : 0;
        var sd = (typeof scheduleDataList !== 'undefined' && scheduleDataList[idx]) ? scheduleDataList[idx] : null;
        var monthNum = scheduleMonthNumber();
        var roundStr = function(r) { return pad2(monthNum) + '월 ' + pad2(r) + '차'; };
        var companies = config.companies || [];
        var bigoMap = config.bigoExamples || {};
        var roundOverrides = config.roundOverrides || {};
        var demo = config.demo;

        return companies.map(function(co) {
            var override = roundOverrides[co];
            var r = (override >= 1) ? parseInt(override, 10) : pickRoundForCompany(sd, co);
            return {
                company: co,
                round: roundStr(r),
                branchName: demo.branchName || '튜토리얼사업단',
                branchCode: demo.branchCode || '00000',
                sabun: demo.sabun,
                name: demo.name,
                bigo: bigoMap[co] || ''
            };
        });
    }

    function replaceTokens(text) {
        if (!text) return '';
        var demo = config && config.demo ? config.demo : {};
        return String(text)
            .replace(/\{\{demoSabun\}\}/g, demo.sabun || '')
            .replace(/\{\{demoName\}\}/g, demo.name || '')
            .replace(/\{\{monthLabel\}\}/g, monthLabelText())
            .replace(/\{\{companyCount\}\}/g, String((config.companies || []).length))
            .replace(/\{\{disclaimer\}\}/g, demo.disclaimer || '');
    }

    function ensureOverlay() {
        if (overlayEl) return;
        overlayEl = document.createElement('div');
        overlayEl.id = 'tutorialOverlay';
        overlayEl.className = 'tutorial-overlay';
        overlayEl.innerHTML =
            '<div class="tutorial-backdrop" id="tutorialBackdrop"></div>' +
            '<div class="tutorial-spotlight-hole" id="tutorialSpotHole"></div>' +
            '<div class="tutorial-popover" id="tutorialPopover" role="dialog" aria-modal="true">' +
                '<div class="tutorial-popover__badge" id="tutorialStepBadge"></div>' +
                '<div class="tutorial-popover__title" id="tutorialPopoverTitle"></div>' +
                '<div class="tutorial-popover__body" id="tutorialPopoverBody"></div>' +
                '<div class="tutorial-popover__actions">' +
                    '<button type="button" class="tutorial-btn tutorial-btn--ghost" id="tutorialBtnSkip">건너뛰기</button>' +
                    '<button type="button" class="tutorial-btn tutorial-btn--ghost" id="tutorialBtnPrev">이전</button>' +
                    '<button type="button" class="tutorial-btn tutorial-btn--primary" id="tutorialBtnNext">다음</button>' +
                    '<button type="button" class="tutorial-btn tutorial-btn--close" id="tutorialBtnClose">닫기</button>' +
                '</div>' +
                '<button type="button" class="tutorial-link-usage" id="tutorialLinkUsage" hidden>📋 전체 사용법 보기</button>' +
            '</div>';
        document.body.appendChild(overlayEl);

        document.getElementById('tutorialBtnNext').addEventListener('click', onNext);
        document.getElementById('tutorialBtnPrev').addEventListener('click', onPrev);
        document.getElementById('tutorialBtnSkip').addEventListener('click', stop);
        document.getElementById('tutorialBtnClose').addEventListener('click', stop);
        document.getElementById('tutorialLinkUsage').addEventListener('click', function() {
            stop();
            if (typeof showUsageText === 'function') showUsageText();
        });

        popoverEl = document.getElementById('tutorialPopover');
        spotHoleEl = document.getElementById('tutorialSpotHole');
        backdropEl = document.getElementById('tutorialBackdrop');
        hookScheduleModalClose();
        hookScheduleBtnDuringTutorial();
    }

    function hookScheduleBtnDuringTutorial() {
        if (document.body._tutorialSchedBtnHooked) return;
        document.body._tutorialSchedBtnHooked = true;
        document.addEventListener('click', function(e) {
            if (!active || !config || !config.steps) return;
            var step = config.steps[stepIndex];
            if (!step || step.id !== 'schedule-btn') return;
            var btn = e.target.closest('#tableBody .schedule-btn');
            if (!btn) return;
            e.preventDefault();
            e.stopImmediatePropagation();
        }, true);
    }

    function hookScheduleModalClose() {
        if (scheduleCloseHooked) return;
        scheduleCloseHooked = true;
        document.addEventListener('click', function(e) {
            if (!active || !config || !config.steps) return;
            var step = config.steps[stepIndex];
            if (!step || step.id !== 'schedule-modal') return;
            var btn = e.target.closest('#scheduleModal .modal-close');
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            if (typeof closeModal === 'function') closeModal('scheduleModal');
            document.body.classList.remove('tutorial-schedule-open');
            if (overlayEl) overlayEl.classList.remove('tutorial-overlay--schedule-step');
            if (popoverEl && overlayEl && popoverEl.parentNode === document.body) {
                overlayEl.appendChild(popoverEl);
            }
            /* 인사일정만 닫고, 완료 안내는 튜토리얼 「다음」으로 진행 */
            setTimeout(showStepUI, 80);
        }, true);
    }

    function clearElevate() {
        if (elevatedEl) {
            elevatedEl.classList.remove('tutorial-target-elevated');
            elevatedEl = null;
        }
    }

    function elevateElement(el) {
        clearElevate();
        if (!el) return;
        elevatedEl = el;
        elevatedEl.classList.add('tutorial-target-elevated');
    }

    function clearFocusMarkers() {
        document.querySelectorAll('.tutorial-cell-focus').forEach(function(el) {
            el.classList.remove('tutorial-cell-focus');
        });
        document.querySelectorAll('.tutorial-btn-focus').forEach(function(el) {
            el.classList.remove('tutorial-btn-focus');
        });
        focusEl = null;
    }

    function clearSpotlight() {
        if (backdropEl) {
            backdropEl.style.clipPath = '';
            backdropEl.style.webkitClipPath = '';
        }
        if (spotHoleEl) spotHoleEl.classList.remove('active');
        clearElevate();
        clearFocusMarkers();
        if (overlayEl) overlayEl.classList.remove('tutorial-overlay--schedule-step');
    }

    function showInitialSearchView() {
        var tc = document.getElementById('tableContainer');
        var im = document.getElementById('initialMessage');
        if (tc) tc.style.display = 'none';
        if (im) im.style.display = 'block';
        if (typeof setSearchResultsUi === 'function') setSearchResultsUi(false);
        if (typeof setMobileSearchSummary === 'function') setMobileSearchSummary('');
    }

    function showResultsView() {
        var im = document.getElementById('initialMessage');
        var tc = document.getElementById('tableContainer');
        if (im) im.style.display = 'none';
        if (tc) tc.style.display = 'block';
    }

    function ensureDemoResultsVisible() {
        if (!demoRows.length) {
            runDemoSearch();
            return;
        }
        showResultsView();
        if (typeof setSearchResultsUi === 'function') setSearchResultsUi(true);
    }

    function resolveRowEl(step) {
        if (!step || !step.rowTarget) return null;
        var row = document.querySelector(step.rowTarget);
        if (!row && step.rowTargetFallback) {
            row = document.querySelector(step.rowTargetFallback);
        }
        return row;
    }

    function applyRowFocusSpotlight(step) {
        var row = resolveRowEl(step);
        if (!row) {
            clearSpotlight();
            return null;
        }
        elevateElement(row);
        var rowRect = getRect(row);
        applySpotlight(rowRect, 8, row);
        if (step.focusTarget) {
            var focus = row.querySelector(step.focusTarget);
            if (focus) {
                focusEl = focus;
                if (focus.classList.contains('schedule-btn')) {
                    focus.classList.add('tutorial-btn-focus');
                } else {
                    focus.classList.add('tutorial-cell-focus');
                }
            }
        }
        return rowRect;
    }

    function positionPopoverUnderScheduleModal() {
        var modalBox = document.querySelector('#scheduleModal .modal-box');
        if (!modalBox) {
            positionPopover(null);
            return;
        }
        positionPopover(getRect(modalBox), { centerUnder: true, margin: 14 });
    }

    function queryTargetElement(step) {
        if (!step) return null;
        if (step.highlightUnion && step.highlightUnion.length) {
            return document.querySelector(step.highlightUnion[0]);
        }
        if (!step.target) return null;
        var el = document.querySelector(step.target);
        if (el) return el;
        if (step.targetFallback) return document.querySelector(step.targetFallback);
        return null;
    }

    function getRect(el) {
        if (!el || !el.getBoundingClientRect) return null;
        var r = el.getBoundingClientRect();
        if (r.width < 1 && r.height < 1) return null;
        return r;
    }

    function getUnionRect(selectors) {
        if (!selectors || !selectors.length) return null;
        var union = null;
        selectors.forEach(function(sel) {
            var el = document.querySelector(sel);
            var r = getRect(el);
            if (!r) return;
            if (!union) {
                union = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
            } else {
                union.left = Math.min(union.left, r.left);
                union.top = Math.min(union.top, r.top);
                union.right = Math.max(union.right, r.right);
                union.bottom = Math.max(union.bottom, r.bottom);
            }
        });
        if (!union) return null;
        return {
            left: union.left,
            top: union.top,
            width: union.right - union.left,
            height: union.bottom - union.top
        };
    }

    function applySpotlight(rect, pad, targetEl) {
        pad = pad == null ? 10 : pad;
        if (!rect) {
            clearSpotlight();
            return;
        }
        var x1 = Math.max(0, rect.left - pad);
        var y1 = Math.max(0, rect.top - pad);
        var x2 = Math.min(window.innerWidth, rect.left + rect.width + pad);
        var y2 = Math.min(window.innerHeight, rect.top + rect.height + pad);
        var w = window.innerWidth;
        var h = window.innerHeight;

        if (backdropEl) {
            var cp = 'polygon(evenodd,' +
                '0px 0px,' + w + 'px 0px,' + w + 'px ' + h + 'px,0px ' + h + 'px,0px 0px,' +
                x1 + 'px ' + y1 + 'px,' + x2 + 'px ' + y1 + 'px,' +
                x2 + 'px ' + y2 + 'px,' + x1 + 'px ' + y2 + 'px,' + x1 + 'px ' + y1 + 'px)';
            backdropEl.style.clipPath = cp;
            backdropEl.style.webkitClipPath = cp;
        }
        if (spotHoleEl) {
            spotHoleEl.style.left = x1 + 'px';
            spotHoleEl.style.top = y1 + 'px';
            spotHoleEl.style.width = (x2 - x1) + 'px';
            spotHoleEl.style.height = (y2 - y1) + 'px';
            spotHoleEl.classList.add('active');
        }
        if (targetEl) elevateElement(targetEl);
    }

    function queryTargetRect(step) {
        if (!step) return null;
        if (step.highlightUnion && step.highlightUnion.length) {
            return getUnionRect(step.highlightUnion);
        }
        if (!step.target) return null;
        var el = document.querySelector(step.target);
        if (el) return getRect(el);
        if (step.targetFallback) {
            el = document.querySelector(step.targetFallback);
            return getRect(el);
        }
        return null;
    }

    function setModalFrontMode(on, kind) {
        if (!overlayEl) return;
        overlayEl.classList.toggle('tutorial-overlay--modal-front', !!on);
        document.body.classList.remove('tutorial-readme-open', 'tutorial-schedule-open');
        if (on && kind === 'readme') document.body.classList.add('tutorial-readme-open');
        if (on && kind === 'schedule') document.body.classList.add('tutorial-schedule-open');
    }

    function setNextPulse(on) {
        var btn = document.getElementById('tutorialBtnNext');
        if (!btn) return;
        btn.classList.toggle('tutorial-btn--pulse', !!on);
    }

    function prefillDemoSabun() {
        if (!config || !config.demo) return;
        var input = document.getElementById('searchInput');
        if (input) input.value = config.demo.sabun;
    }

    function positionPopover(targetRect, opts) {
        opts = opts || {};
        if (!popoverEl) return;
        popoverEl.style.display = 'block';
        popoverEl.style.left = '';
        popoverEl.style.top = '';
        popoverEl.style.right = '';
        popoverEl.style.bottom = '';
        popoverEl.style.transform = '';

        var margin = opts.margin == null ? 12 : opts.margin;
        var vw = window.innerWidth;
        var vh = window.innerHeight;

        if (!targetRect) {
            popoverEl.style.left = '50%';
            popoverEl.style.top = '50%';
            popoverEl.style.transform = 'translate(-50%, -50%)';
            return;
        }

        var popRect = popoverEl.getBoundingClientRect();
        var left = opts.centerUnder
            ? targetRect.left + (targetRect.width - popRect.width) / 2
            : targetRect.left;
        var top = targetRect.top + targetRect.height + margin;

        if (top + popRect.height > vh - margin) {
            top = targetRect.top - popRect.height - margin;
        }
        if (top < margin) top = margin;
        if (left + popRect.width > vw - margin) {
            left = vw - popRect.width - margin;
        }
        if (left < margin) left = margin;

        popoverEl.style.left = left + 'px';
        popoverEl.style.top = top + 'px';
    }

    function getFocusAnchorRect(step) {
        var row = resolveRowEl(step);
        if (!row || !step.focusTarget) return null;
        var focus = row.querySelector(step.focusTarget);
        return focus ? getRect(focus) : null;
    }

    function positionPopoverForStep(step, fallbackRect) {
        var anchor = (step && step.highlightMode === 'rowFocus') ? getFocusAnchorRect(step) : null;
        positionPopover(anchor || fallbackRect, { centerUnder: true });
    }

    function renderDemoTable() {
        demoRows = buildDemoRows();
        var visibleRows = filterDemoRowsForCompany(demoRows);
        var container = document.getElementById('tableContainer');
        var initial = document.getElementById('initialMessage');
        var body = document.getElementById('tableBody');
        if (!container || !body) return false;

        if (typeof setSearchResultsUi === 'function') setSearchResultsUi(true);
        setDemoResultHint(true);
        if (typeof setMobileSearchSummary === 'function' && config.demo) {
            setMobileSearchSummary(config.demo.name);
        }

        if (initial) initial.style.display = 'none';
        container.style.display = 'block';
        body.innerHTML = '';

        if (demoRows.length === 0) {
            body.innerHTML = '<tr><td colspan="8" class="no-results">예시 일정 데이터를 불러오지 못했습니다. 인사일정 JSON을 확인해 주세요.</td></tr>';
            document.getElementById('resultCount').textContent = '0';
            return false;
        }

        if (visibleRows.length === 0) {
            body.innerHTML = '<tr><td colspan="8" class="no-results">해당 보험사 조건에 맞는 행이 없습니다.</td></tr>';
            document.getElementById('resultCount').textContent = '0';
            return true;
        }

        var fmtCo = typeof formatCompanyDisplayName === 'function'
            ? formatCompanyDisplayName
            : function(c) { return c; };
        var esc = typeof escapeHtml === 'function' ? escapeHtml : function(s) { return s; };

        visibleRows.forEach(function(row, i) {
            var tr = document.createElement('tr');
            tr.className = 'tutorial-demo-row demo-example-row';
            if (i === 0) tr.classList.add('tutorial-demo-row--first');
            tr.innerHTML =
                '<td>' + esc(fmtCo(row.company)) + '</td>' +
                '<td><span class="badge-round badge-latest">' + esc(row.round) + '</span></td>' +
                '<td>' + esc(row.branchName) + '</td>' +
                '<td>' + esc(row.branchCode) + '</td>' +
                '<td>' + esc(row.sabun) + '</td>' +
                '<td>' + esc(row.name) + '</td>' +
                '<td>' + esc(row.bigo) + '</td>' +
                '<td><button type="button" class="schedule-btn" aria-label="인사일정">📅</button></td>';
            tr.dataset.scheduleCo = encodeURIComponent(row.company);
            tr.dataset.scheduleRound = encodeURIComponent(row.round);
            tr.dataset.scheduleSabun = encodeURIComponent(row.sabun);
            tr.dataset.scheduleName = encodeURIComponent(row.name);
            body.appendChild(tr);
        });

        document.getElementById('resultCount').textContent = String(visibleRows.length);
        return true;
    }

    function runDemoSearch() {
        prefillDemoSabun();
        renderDemoTable();
        showResultsView();
    }

    function openFirstSchedule() {
        if (!demoRows.length) return;
        var row = demoRows[0];
        if (typeof showSchedule === 'function') {
            showSchedule(row.company, row.round, row.sabun, row.name);
        }
    }

    function waitForReadmeThen(next) {
        var modal = document.getElementById('readmeModal');
        if (!modal) { next(); return; }
        readmeOpen = true;
        setModalFrontMode(true, 'readme');
        clearSpotlight();
        if (typeof showReadme === 'function') showReadme();

        var done = false;
        function finish() {
            if (done) return;
            done = true;
            readmeOpen = false;
            observer.disconnect();
            modal.removeEventListener('click', onOverlay);
            setModalFrontMode(false);
            setNextPulse(true);
            next();
        }
        var observer = new MutationObserver(function() {
            if (!modal.classList.contains('active')) finish();
        });
        observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
        function onOverlay(e) {
            if (e.target === modal) finish();
        }
        modal.addEventListener('click', onOverlay);
    }

    function showStepUI() {
        var steps = config && config.steps ? config.steps : [];
        var step = steps[stepIndex];
        if (!step) {
            stop();
            return;
        }

        ensureOverlay();
        overlayEl.classList.add('active');
        document.body.classList.add('tutorial-active');
        setModalFrontMode(false);

        var badge = document.getElementById('tutorialStepBadge');
        var titleEl = document.getElementById('tutorialPopoverTitle');
        var bodyEl = document.getElementById('tutorialPopoverBody');
        var btnPrev = document.getElementById('tutorialBtnPrev');
        var btnNext = document.getElementById('tutorialBtnNext');
        var linkUsage = document.getElementById('tutorialLinkUsage');

        if (badge) badge.textContent = (stepIndex + 1) + ' / ' + steps.length;
        if (titleEl) titleEl.textContent = step.title || '';
        if (bodyEl) bodyEl.innerHTML = replaceTokens(step.body || '');

        if (btnPrev) btnPrev.disabled = stepIndex <= 0;
        if (btnNext) {
            btnNext.style.display = '';
            if (step.type === 'finish') {
                btnNext.textContent = '닫기';
            } else if (step.type === 'readme') {
                btnNext.textContent = '필독 열기';
            } else {
                btnNext.textContent = '다음';
            }
        }
        if (linkUsage) linkUsage.hidden = step.type !== 'finish';

        if (step.initialView || step.id === 'sabun') {
            showInitialSearchView();
        }
        if (step.prefillSabun || step.id === 'sabun') {
            prefillDemoSabun();
        }
        if (step.id !== 'sabun' && step.id !== 'readme-first' && step.type !== 'readme' && step.type !== 'finish') {
            ensureDemoResultsVisible();
        }

        setNextPulse(step.type !== 'readme' && step.type !== 'finish');

        if (overlayEl) {
            overlayEl.classList.remove('tutorial-overlay--schedule-step');
            overlayEl.style.pointerEvents = '';
            if (popoverEl && overlayEl && popoverEl.parentNode === document.body) {
                overlayEl.appendChild(popoverEl);
            }
        }
        document.body.classList.remove('tutorial-schedule-open');

        if (step.id === 'bigo' && typeof closeModal === 'function') {
            closeModal('scheduleModal');
        }

        if (step.type === 'readme' || step.type === 'finish') {
            if (step.type === 'finish' && typeof closeModal === 'function') {
                closeModal('scheduleModal');
                document.body.classList.remove('tutorial-schedule-open');
                if (overlayEl) overlayEl.classList.remove('tutorial-overlay--schedule-step');
                if (popoverEl && overlayEl && popoverEl.parentNode === document.body) {
                    overlayEl.appendChild(popoverEl);
                }
            }
            clearSpotlight();
            if (backdropEl) {
                backdropEl.style.clipPath = '';
                backdropEl.style.webkitClipPath = '';
                backdropEl.style.display = '';
            }
            positionPopover(null);
            return;
        }

        if (step.spotlight === 'scheduleModal' || step.id === 'schedule-modal') {
            if (overlayEl) {
                overlayEl.classList.add('tutorial-overlay--schedule-step');
                overlayEl.style.pointerEvents = 'none';
            }
            document.body.classList.add('tutorial-schedule-open');
            if (spotHoleEl) spotHoleEl.classList.remove('active');
            if (backdropEl) {
                backdropEl.style.clipPath = '';
                backdropEl.style.webkitClipPath = '';
            }
            clearElevate();
            clearFocusMarkers();
            if (typeof closeModal === 'function') {
                ['usageModal', 'readmeModal', 'columnHelpModal', 'allScheduleModal', 'preSubmitUrlModal'].forEach(function(id) {
                    closeModal(id);
                });
            }
            openFirstSchedule();
            /* 말풍선을 body 직속으로 올려 모달 blur/z-index 영향 제거 */
            if (popoverEl && popoverEl.parentNode !== document.body) {
                document.body.appendChild(popoverEl);
            }
            setTimeout(function() {
                positionPopoverUnderScheduleModal();
            }, 150);
            return;
        }

        if (overlayEl) overlayEl.style.pointerEvents = '';

        if (step.highlightMode === 'rowFocus') {
            var rowRect = applyRowFocusSpotlight(step);
            positionPopoverForStep(step, rowRect);
            if (resolveRowEl(step)) {
                try { resolveRowEl(step).scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
            }
            return;
        }

        var targetEl = queryTargetElement(step);
        if (step.id === 'result-table') {
            targetEl = document.getElementById('tableContainer');
        }
        var targetRect = queryTargetRect(step);
        applySpotlight(targetRect, step.id === 'result-table' ? 10 : 10, targetEl);
        positionPopover(targetRect);
        if (targetEl) {
            try { targetEl.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
        }
    }

    function onNext() {
        var steps = config && config.steps ? config.steps : [];
        var step = steps[stepIndex];
        if (!step) return;

        setNextPulse(false);

        if (step.type === 'readme') {
            waitForReadmeThen(function() {
                stepIndex++;
                showStepUI();
            });
            return;
        }

        if (step.type === 'finish') {
            stop();
            return;
        }

        if (step.action === 'demoSearch') {
            runDemoSearch();
            stepIndex++;
            setTimeout(showStepUI, 80);
            return;
        }

        if (step.id === 'schedule-btn') {
            stepIndex++;
            setTimeout(showStepUI, 80);
            return;
        }

        if (step.id === 'schedule-modal') {
            if (typeof closeModal === 'function') closeModal('scheduleModal');
            document.body.classList.remove('tutorial-schedule-open');
            if (overlayEl) overlayEl.classList.remove('tutorial-overlay--schedule-step');
            if (popoverEl && overlayEl && popoverEl.parentNode === document.body) {
                overlayEl.appendChild(popoverEl);
            }
            stepIndex++;
            setTimeout(showStepUI, 80);
            return;
        }

        stepIndex++;
        if (stepIndex >= steps.length) {
            stop();
            return;
        }
        showStepUI();
    }

    function onPrev() {
        if (stepIndex <= 0) return;
        var steps = config.steps;
        var cur = steps[stepIndex];
        if (cur && cur.id === 'schedule-modal' && typeof closeModal === 'function') {
            closeModal('scheduleModal');
            document.body.classList.remove('tutorial-schedule-open');
        }
        stepIndex--;
        showStepUI();
    }

    function resetToMainScreen() {
        var input = document.getElementById('searchInput');
        if (input) input.value = '';
        var coIn = document.getElementById('companyFilterInput');
        if (coIn) coIn.value = '';

        var ms = document.getElementById('mobileSearchSummary');
        if (ms) {
            ms.textContent = '';
            ms.removeAttribute('data-active');
        }

        if (typeof setSearchResultsUi === 'function') setSearchResultsUi(false);
        if (typeof setMobileSearchSummary === 'function') setMobileSearchSummary('');

        var hint = document.getElementById('resultInfoHint');
        if (hint) {
            hint.textContent = DEFAULT_RESULT_HINT;
            hint.classList.add('is-off');
        }

        var box = document.getElementById('searchBox');
        if (box) box.classList.remove('search-box--has-results');

        /* 메인 화면 filterTable(빈 사번)과 동일한 초기 상태 */
        if (typeof filterTable === 'function') {
            filterTable({ skipAnalytics: true });
        } else {
            var tc = document.getElementById('tableContainer');
            var im = document.getElementById('initialMessage');
            var body = document.getElementById('tableBody');
            if (tc) tc.style.display = 'none';
            if (im) im.style.display = 'block';
            if (body) body.innerHTML = '';
            var rc = document.getElementById('resultCount');
            if (rc) rc.textContent = '0';
        }

        try { window.scrollTo(0, 0); } catch (e) {}
        var results = document.querySelector('.container__results');
        if (results && results.scrollTop) results.scrollTop = 0;
    }

    function stop() {
        var wasActive = active;
        active = false;
        stepIndex = 0;
        demoRows = [];
        readmeOpen = false;
        clearSpotlight();
        setModalFrontMode(false);
        setNextPulse(false);
        if (overlayEl) {
            overlayEl.classList.remove('active');
            overlayEl.classList.remove('tutorial-overlay--schedule-step');
            overlayEl.style.pointerEvents = '';
            if (popoverEl && overlayEl && popoverEl.parentNode === document.body) {
                overlayEl.appendChild(popoverEl);
            }
        }
        document.body.classList.remove('tutorial-active', 'tutorial-schedule-open');
        if (typeof closeModal === 'function') {
            closeModal('scheduleModal');
            closeModal('readmeModal');
            closeModal('usageModal');
            closeModal('columnHelpModal');
            closeModal('allScheduleModal');
            closeModal('preSubmitUrlModal');
        }
        if (wasActive) resetToMainScreen();
    }

    function onEscape() {
        if (!active) return false;
        if (readmeOpen) return false;
        stop();
        return true;
    }

    function handleSearch(val) {
        if (!isDemoSabun(val)) return false;
        renderDemoTable();
        return true;
    }

    function tryDemoSearchAsync(val, opts) {
        if (!String(val || '').trim()) return Promise.resolve(false);
        return ensureConfig()
            .then(function() { return handleSearch(val, opts); })
            .catch(function() { return false; });
    }

    async function start() {
        if (active) return;
        try {
            await ensureConfig();
        } catch (e) {
            alert('튜토리얼을 시작할 수 없습니다.\n' + (e.message || e));
            return;
        }

        if (typeof scheduleDataList === 'undefined' || !scheduleDataList.length) {
            alert('인사일정을 먼저 불러온 뒤 튜토리얼을 시작해 주세요.');
            return;
        }

        active = true;
        stepIndex = 0;
        demoRows = [];
        ensureOverlay();
        showStepUI();
    }

    global.Tutorial = {
        start: start,
        stop: stop,
        handleSearch: handleSearch,
        tryDemoSearchAsync: tryDemoSearchAsync,
        ensureConfig: ensureConfig,
        isConfigReady: function() { return !!config; },
        isDemoSabun: isDemoSabun,
        onEscape: onEscape,
        isActive: function() { return active; }
    };

    function preloadConfig() {
        ensureConfig().catch(function() {});
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', preloadConfig);
    } else {
        preloadConfig();
    }

    global.startTutorialFromUsage = function() {
        if (typeof closeModal === 'function') closeModal('usageModal');
        start();
    };

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && active && !readmeOpen) {
            e.stopPropagation();
            onEscape();
        }
    }, true);

    window.addEventListener('resize', function() {
        if (!active || readmeOpen || !config || !config.steps) return;
        var step = config.steps[stepIndex];
        if (step && step.id === 'schedule-modal') {
            positionPopoverUnderScheduleModal();
            return;
        }
        showStepUI();
    });
})(window);
