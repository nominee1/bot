import { observer as globalObserver } from '../../../utils/observer';
import { apolloRuntime } from '../utils/apollo-runtime';

const notify = message => {
    try {
        globalObserver.emit('ui.log.notify', { message, className: 'info' });
    } catch {
        // ignore
    }
};

const STREAK = 3;

const allEven = (digits, n = STREAK) =>
    Boolean(digits?.length) && digits.length >= n && digits.slice(-n).every(d => d % 2 === 0);

const allOdd = (digits, n = STREAK) =>
    Boolean(digits?.length) && digits.length >= n && digits.slice(-n).every(d => d % 2 === 1);

const VOLATILITY_MARKETS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'];

const RANDY_KINDS = ['differ0', 'over1', 'over2', 'differ9', 'under8', 'under7'];
const RANDY_LABELS = {
    differ0: 'DIFFER 0',
    over1: 'OVER 1',
    over2: 'OVER 2',
    differ9: 'DIFFER 9',
    under8: 'UNDER 8',
    under7: 'UNDER 7',
};

const SEQUENCE_PRESETS = {
    over_12_recover_over4: {
        stepCount: 2,
        recoveryOnLoss: true,
        recoveryMode: 'over4',
        labels: { 1: 'OVER 1', 2: 'OVER 2' },
        steps: { 1: 'over1', 2: 'over2' },
    },
    diff0_over12_diff9_u87: {
        stepCount: 6,
        recoveryOnLoss: true,
        recoveryMode: 'streak',
        labels: {
            1: 'DIFFER 0',
            2: 'OVER 1',
            3: 'OVER 2',
            4: 'DIFFER 9',
            5: 'UNDER 8',
            6: 'UNDER 7',
        },
        steps: {
            1: 'differ0',
            2: 'over1',
            3: 'over2',
            4: 'differ9',
            5: 'under8',
            6: 'under7',
        },
    },
};

const clampBarrier = (value, fallback, min, max) => {
    const n = parseInt(value, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
};

/**
 * Dbotweb Athena strategy blocks — Over/Under switch, Over Hunter, SV Switcher,
 * Randy, Even/Odd strategy, contract sequences, rotate-each-trade.
 */
export default Engine =>
    class DbotwebStrategies extends Engine {
        // ── shared helpers ──────────────────────────────────────────────

        async _dbwDigits(count = 15) {
            if (typeof this.getDigitsForStrategy === 'function') {
                return this.getDigitsForStrategy(count);
            }
            const digits = await this.getLastDigitList();
            return (digits || []).slice(-Math.max(count, 15));
        }

        _dbwSetContract(type, prediction) {
            if (typeof this.setNextContractType === 'function') {
                this.setNextContractType(type, prediction);
                return;
            }
            apolloRuntime.contract_switcher = type;
            apolloRuntime.skip_purchase = false;
            if (!this.tradeOptions) return;
            const next = { ...this.tradeOptions, contract_type: type };
            if (type === 'DIGITEVEN' || type === 'DIGITODD') {
                delete next.prediction;
                delete next.barrier;
            } else if (prediction !== undefined && prediction !== '' && !Number.isNaN(Number(prediction))) {
                const value = Number(prediction);
                next.prediction = value;
                next.barrier = value;
                this.setPrediction?.(value);
            }
            this.tradeOptions = next;
        }

        _dbwCurrentSymbol() {
            if (typeof this.getCurrentSymbol === 'function') return this.getCurrentSymbol();
            return this.tradeOptions?.symbol || this.options?.symbol || '';
        }

        async _dbwSetMarket(symbol) {
            if (!symbol) return;
            if (typeof this.setMarket === 'function') {
                await this.setMarket(symbol);
                return;
            }
            if (this.tradeOptions) this.tradeOptions = { ...this.tradeOptions, symbol };
            if (this.options) this.options.symbol = symbol;
            if (typeof this.updateWorkspaceSymbol === 'function') {
                await this.updateWorkspaceSymbol(symbol);
            }
            notify(`[MarketRotate] Switched to ${symbol}`);
        }

        // ── Over / Under switch (Autoswitcher) ──────────────────────────

        async applyOverUnderSwitch(overN = 2, underN = 7, lossesToSwitch = 1) {
            const over = clampBarrier(overN, 2, 0, 8);
            const under = clampBarrier(underN, 7, 1, 9);
            const losses = Math.max(1, parseInt(lossesToSwitch, 10) || 1);
            if (this._overUnderSwitch) {
                this._overUnderSwitch.overN = over;
                this._overUnderSwitch.underN = under;
                this._overUnderSwitch.lossesToSwitch = losses;
            } else {
                this._overUnderSwitch = {
                    mode: 'over',
                    overN: over,
                    underN: under,
                    lossesToSwitch: losses,
                    overLossCount: 0,
                    underLossCount: 0,
                };
            }
            this._overUnderSwitchActive = true;
            const state = this._overUnderSwitch;
            if (state.mode === 'under') {
                this._dbwSetContract('DIGITUNDER', state.underN);
                notify(
                    `[OverUnderSwitch] UNDER ${state.underN} (${state.underLossCount}/${state.lossesToSwitch} losses before Over ${state.overN})`
                );
            } else {
                this._dbwSetContract('DIGITOVER', state.overN);
                notify(
                    `[OverUnderSwitch] OVER ${state.overN} (${state.overLossCount}/${state.lossesToSwitch} losses before Under ${state.underN})`
                );
            }
            return true;
        }

        async applyOver2Under7Switch() {
            return this.applyOverUnderSwitch(2, 7, 1);
        }

        onOverUnderSwitchSettlement(won) {
            if (!this._overUnderSwitchActive || !this._overUnderSwitch) return;
            const state = this._overUnderSwitch;
            const need = state.lossesToSwitch;
            if (state.mode === 'over') {
                if (won) {
                    state.overLossCount = 0;
                    notify(`[OverUnderSwitch] Over ${state.overN} win — Over loss counter reset`);
                    return;
                }
                state.overLossCount += 1;
                notify(`[OverUnderSwitch] Over ${state.overN} loss ${state.overLossCount}/${need}`);
                if (state.overLossCount >= need) {
                    state.mode = 'under';
                    state.overLossCount = 0;
                    state.underLossCount = 0;
                    notify(`[OverUnderSwitch] ${need} Over loss(es) — switching to UNDER ${state.underN}`);
                }
                return;
            }
            if (won) {
                state.underLossCount = 0;
                notify(`[OverUnderSwitch] Under ${state.underN} win — Under loss counter reset`);
                return;
            }
            state.underLossCount += 1;
            notify(`[OverUnderSwitch] Under ${state.underN} loss ${state.underLossCount}/${need}`);
            if (state.underLossCount >= need) {
                state.mode = 'over';
                state.overLossCount = 0;
                state.underLossCount = 0;
                notify(`[OverUnderSwitch] ${need} Under loss(es) — back to OVER ${state.overN}`);
            }
        }

        // ── Over Hunter ─────────────────────────────────────────────────

        async applyOverHunter(overX = 2, underN = 7, recoveryV = 5) {
            const over = clampBarrier(overX, 2, 0, 8);
            const under = clampBarrier(underN, 7, 1, 9);
            const recovery = clampBarrier(recoveryV, 5, 1, 9);
            if (this._overHunter) {
                this._overHunter.overX = over;
                this._overHunter.underN = under;
                this._overHunter.recoveryV = recovery;
            } else {
                this._overHunter = { phase: 'over', overX: over, underN: under, recoveryV: recovery };
            }
            this._overHunterActive = true;
            const state = this._overHunter;
            if (state.phase === 'recovery') {
                this._dbwSetContract('DIGITUNDER', state.recoveryV);
                notify(`[OverHunter] RECOVERY UNDER ${state.recoveryV}`);
            } else if (state.phase === 'under_after_loss') {
                this._dbwSetContract('DIGITUNDER', state.underN);
                notify(`[OverHunter] UNDER ${state.underN} after loss`);
            } else {
                this._dbwSetContract('DIGITOVER', state.overX);
                notify(`[OverHunter] OVER ${state.overX}`);
            }
            return true;
        }

        onOverHunterSettlement(won) {
            if (!this._overHunterActive || !this._overHunter) return;
            const state = this._overHunter;
            if (won) {
                state.phase = 'over';
                notify(`[OverHunter] Win — back to OVER ${state.overX}`);
                return;
            }
            if (state.phase === 'over') {
                state.phase = 'under_after_loss';
                notify(`[OverHunter] Loss on OVER ${state.overX} — next UNDER ${state.underN}`);
                return;
            }
            if (state.phase === 'under_after_loss') {
                state.phase = 'recovery';
                notify(`[OverHunter] Loss on UNDER ${state.underN} — recovery UNDER ${state.recoveryV}`);
                return;
            }
            notify(`[OverHunter] Loss on recovery UNDER ${state.recoveryV} — stay on recovery`);
        }

        // ── SV Switcher (Over/Under + even/odd recovery) ────────────────

        async applyOverUnderEoRecovery(overX = 1, underN = 8) {
            const over = clampBarrier(overX, 1, 0, 8);
            const under = clampBarrier(underN, 8, 1, 9);
            if (this._overUnderEo) {
                this._overUnderEo.overX = over;
                this._overUnderEo.underN = under;
            } else {
                this._overUnderEo = { side: 'over', inRecovery: false, overX: over, underN: under };
            }
            this._overUnderEoActive = true;
            this._overUnderEoBlocked = false;
            apolloRuntime.skip_purchase = false;

            if (this._overUnderEo.inRecovery) {
                return this._svRecoveryTrade();
            }
            const state = this._overUnderEo;
            if (state.side === 'under') {
                this._dbwSetContract('DIGITUNDER', state.underN);
                notify(`[SVSwitcher] UNDER ${state.underN}`);
            } else {
                this._dbwSetContract('DIGITOVER', state.overX);
                notify(`[SVSwitcher] OVER ${state.overX}`);
            }
            return true;
        }

        async _svRecoveryTrade() {
            this._overUnderEoBlocked = false;
            apolloRuntime.skip_purchase = false;
            let digits = [];
            try {
                digits = await this._dbwDigits(STREAK);
            } catch {
                digits = [];
            }
            const label = digits.slice(-STREAK).join('') || '—';
            if (allEven(digits, STREAK)) {
                this._dbwSetContract('DIGITEVEN');
                notify(`[SVSwitcher] Loss recovery: ${STREAK} even (${label}) → DIGITEVEN`);
                return true;
            }
            if (allOdd(digits, STREAK)) {
                this._dbwSetContract('DIGITODD');
                notify(`[SVSwitcher] Loss recovery: ${STREAK} odd (${label}) → DIGITODD`);
                return true;
            }
            this._overUnderEoBlocked = true;
            apolloRuntime.skip_purchase = true;
            notify(`[SVSwitcher] Loss recovery waiting for ${STREAK} even/odd (last: ${label})`);
            return false;
        }

        onOverUnderEoSettlement(won) {
            if (!this._overUnderEoActive || !this._overUnderEo) return;
            const state = this._overUnderEo;
            const flip = side => (side === 'over' ? 'under' : 'over');
            if (state.inRecovery) {
                if (won) {
                    state.inRecovery = false;
                    state.side = flip(state.side);
                    this._overUnderEoBlocked = false;
                    notify(
                        `[SVSwitcher] Recovery win — resume ${state.side.toUpperCase()} (${state.side === 'over' ? state.overX : state.underN})`
                    );
                } else {
                    this._overUnderEoBlocked = false;
                    notify('[SVSwitcher] Loss during Even/Odd recovery — stay on recovery');
                }
                return;
            }
            if (won) {
                state.side = flip(state.side);
                this._overUnderEoBlocked = false;
                notify(
                    `[SVSwitcher] Win — next ${state.side.toUpperCase()} (${state.side === 'over' ? state.overX : state.underN})`
                );
                return;
            }
            state.inRecovery = true;
            this._overUnderEoBlocked = false;
            notify(`[SVSwitcher] Loss on ${state.side.toUpperCase()} — Even/Odd recovery`);
        }

        // ── Even / Odd hunter ───────────────────────────────────────────

        async applyEvenOddStrategy() {
            this._evenOddStrategyActive = true;
            this._evenOddStrategyBlocked = false;
            apolloRuntime.skip_purchase = false;
            let digits = [];
            try {
                digits = await this._dbwDigits(STREAK);
            } catch {
                digits = [];
            }
            const label = digits.slice(-STREAK).join('') || '—';
            if (allEven(digits, STREAK)) {
                this._dbwSetContract('DIGITEVEN');
                notify(`[EvenOddStrategy] Last ${STREAK} digits even (${label}) → DIGITEVEN`);
                return true;
            }
            if (allOdd(digits, STREAK)) {
                this._dbwSetContract('DIGITODD');
                notify(`[EvenOddStrategy] Last ${STREAK} digits odd (${label}) → DIGITODD`);
                return true;
            }
            this._evenOddStrategyBlocked = true;
            apolloRuntime.skip_purchase = true;
            notify(`[EvenOddStrategy] Waiting for ${STREAK} even/odd (last: ${label})`);
            return false;
        }

        // ── Randy ───────────────────────────────────────────────────────

        _randyPickKind() {
            if (!this._randy) {
                this._randy = {
                    inRecovery: false,
                    _recoveryFired: false,
                    lastKind: null,
                    remainingKinds: [...RANDY_KINDS],
                };
            }
            let pool = Array.isArray(this._randy.remainingKinds) ? this._randy.remainingKinds : [...RANDY_KINDS];
            if (!pool.length) pool = [...RANDY_KINDS];
            const kind = pool[Math.floor(Math.random() * pool.length)];
            const rest = pool.filter(k => k !== kind);
            this._randy.remainingKinds = rest.length ? rest : RANDY_KINDS.filter(k => k !== kind);
            this._randy.lastKind = kind;
            return kind;
        }

        async _randyApplyKind(kind, label) {
            switch (kind) {
                case 'differ0':
                    this._dbwSetContract('DIGITDIFF', 0);
                    break;
                case 'over1':
                    this._dbwSetContract('DIGITOVER', 1);
                    break;
                case 'over2':
                    this._dbwSetContract('DIGITOVER', 2);
                    break;
                case 'differ9':
                    this._dbwSetContract('DIGITDIFF', 9);
                    break;
                case 'under8':
                    this._dbwSetContract('DIGITUNDER', 8);
                    break;
                case 'under7':
                    this._dbwSetContract('DIGITUNDER', 7);
                    break;
                default:
                    return false;
            }
            notify(`[Randy] ${label}: ${RANDY_LABELS[kind]}`);
            return true;
        }

        async _randyRecovery(digits) {
            if (digits.length < STREAK) {
                this._randyBlocked = true;
                apolloRuntime.skip_purchase = true;
                notify(`[Randy] RECOVERY: need ${STREAK} ticks`);
                return false;
            }
            const label = digits.slice(-STREAK).join('');
            if (allEven(digits, STREAK)) {
                this._dbwSetContract('DIGITEVEN');
                this._randy._recoveryFired = true;
                notify(`[Randy] RECOVERY: even×${STREAK} (${label}) → DIGITEVEN`);
                return true;
            }
            if (allOdd(digits, STREAK)) {
                this._dbwSetContract('DIGITODD');
                this._randy._recoveryFired = true;
                notify(`[Randy] RECOVERY: odd×${STREAK} (${label}) → DIGITODD`);
                return true;
            }
            this._randyBlocked = true;
            apolloRuntime.skip_purchase = true;
            notify(`[Randy] RECOVERY: waiting ${STREAK} even/odd (last: ${label || '—'})`);
            return false;
        }

        async applyRandy() {
            if (!this._randy) {
                this._randy = {
                    inRecovery: false,
                    _recoveryFired: false,
                    lastKind: null,
                    remainingKinds: [...RANDY_KINDS],
                };
            }
            this._randyActive = true;
            this._randyBlocked = false;
            apolloRuntime.skip_purchase = false;
            let digits = [];
            try {
                digits = await this._dbwDigits(15);
            } catch {
                digits = [];
            }
            if (this._randy.inRecovery) {
                const ok = await this._randyRecovery(digits);
                if (ok) this._randyAwaitingSettlement = true;
                return ok;
            }
            const kind = this._randyPickKind();
            const ok = await this._randyApplyKind(kind, `Random → ${RANDY_LABELS[kind]}`);
            if (ok) this._randyAwaitingSettlement = true;
            return ok;
        }

        onRandySettlement(won) {
            if (!this._randyActive || !this._randy) return;
            this._randyAwaitingSettlement = false;
            this._randyBlocked = false;
            if (this._randy.inRecovery) {
                if (this._randy._recoveryFired && won) {
                    this._randy.inRecovery = false;
                    this._randy._recoveryFired = false;
                    notify('[Randy] Recovery won — resuming random picks');
                } else if (this._randy._recoveryFired && !won) {
                    this._randy._recoveryFired = false;
                    notify('[Randy] Recovery loss — waiting for even/odd streak again');
                }
                return;
            }
            if (!won) {
                this._randy.inRecovery = true;
                const label = this._randy.lastKind ? RANDY_LABELS[this._randy.lastKind] : 'trade';
                notify(`[Randy] Loss on ${label} — recovery (even×3 / odd×3)`);
            }
        }

        // ── Contract sequences ──────────────────────────────────────────

        async applyContractSequenceOver12RecoverOver4() {
            return this.applyDbotwebContractSequence('over_12_recover_over4');
        }

        async applyContractSequenceDiff0Over12Diff9Under87() {
            return this.applyDbotwebContractSequence('diff0_over12_diff9_u87');
        }

        async _dbwSeqRecovery(preset, presetKey, digits) {
            if (preset.recoveryMode === 'over4') {
                this._dbwSetContract('DIGITOVER', 4);
                this._dbwContractSeq._recoveryFired = true;
                notify(`[ContractSequence] RECOVERY [${presetKey}]: OVER 4`);
                return true;
            }
            if (digits.length < STREAK) {
                this._dbwContractSequenceBlocked = true;
                apolloRuntime.skip_purchase = true;
                notify(`[ContractSequence] RECOVERY: need ${STREAK} ticks`);
                return false;
            }
            const label = digits.slice(-STREAK).join('');
            if (allEven(digits, STREAK)) {
                this._dbwSetContract('DIGITEVEN');
                this._dbwContractSeq._recoveryFired = true;
                notify(`[ContractSequence] RECOVERY: even×${STREAK} (${label}) → DIGITEVEN`);
                return true;
            }
            if (allOdd(digits, STREAK)) {
                this._dbwSetContract('DIGITODD');
                this._dbwContractSeq._recoveryFired = true;
                notify(`[ContractSequence] RECOVERY: odd×${STREAK} (${label}) → DIGITODD`);
                return true;
            }
            this._dbwContractSequenceBlocked = true;
            apolloRuntime.skip_purchase = true;
            notify(`[ContractSequence] RECOVERY: waiting ${STREAK} even/odd (last: ${label || '—'})`);
            return false;
        }

        async _dbwSeqApplyStep(action, step, presetKey) {
            switch (action) {
                case 'differ0':
                    this._dbwSetContract('DIGITDIFF', 0);
                    break;
                case 'differ9':
                    this._dbwSetContract('DIGITDIFF', 9);
                    break;
                case 'over1':
                    this._dbwSetContract('DIGITOVER', 1);
                    break;
                case 'over2':
                    this._dbwSetContract('DIGITOVER', 2);
                    break;
                case 'under8':
                    this._dbwSetContract('DIGITUNDER', 8);
                    break;
                case 'under7':
                    this._dbwSetContract('DIGITUNDER', 7);
                    break;
                default:
                    return false;
            }
            const label = SEQUENCE_PRESETS[presetKey]?.labels?.[step] || action;
            notify(`[ContractSequence] [${presetKey}] Step ${step}: ${label}`);
            return true;
        }

        async applyDbotwebContractSequence(presetKey) {
            const preset = SEQUENCE_PRESETS[presetKey];
            if (!preset) return false;
            if (!this._dbwContractSeq || this._dbwContractSeq.preset !== presetKey) {
                this._dbwContractSeq = {
                    step: 1,
                    preset: presetKey,
                    inRecovery: false,
                    _recoveryFired: false,
                };
            }
            this._dbwContractSequenceActive = true;
            this._dbwContractSequenceBlocked = false;
            apolloRuntime.skip_purchase = false;

            let digits = [];
            try {
                digits = await this._dbwDigits(15);
            } catch {
                digits = [];
            }

            if (preset.recoveryOnLoss && this._dbwContractSeq.inRecovery) {
                const ok = await this._dbwSeqRecovery(preset, presetKey, digits);
                if (ok) this._dbwContractSequenceAwaitingSettlement = true;
                return ok;
            }

            const step = this._dbwContractSeq.step;
            const action = preset.steps[step];
            const ok = await this._dbwSeqApplyStep(action, step, presetKey);
            if (!ok) {
                this._dbwContractSeq.step = 1;
                return this.applyDbotwebContractSequence(presetKey);
            }
            this._dbwContractSequenceAwaitingSettlement = true;
            return true;
        }

        onDbotwebContractSequenceSettlement(won) {
            if (!this._dbwContractSequenceActive || !this._dbwContractSeq) return;
            const presetKey = this._dbwContractSeq.preset;
            const preset = SEQUENCE_PRESETS[presetKey];
            if (!preset) return;
            this._dbwContractSequenceAwaitingSettlement = false;
            this._dbwContractSequenceBlocked = false;
            const seq = this._dbwContractSeq;

            if (preset.recoveryOnLoss) {
                if (seq.inRecovery) {
                    if (seq._recoveryFired && won) {
                        seq.inRecovery = false;
                        seq._recoveryFired = false;
                        seq.step = 1;
                        notify(`[ContractSequence] Recovery won — resume ${presetKey} at step 1`);
                    } else if (seq._recoveryFired && !won) {
                        seq._recoveryFired = false;
                        notify(
                            `[ContractSequence] Recovery loss — ${
                                preset.recoveryMode === 'over4' ? 'retry OVER 4' : 'wait for streak again'
                            }`
                        );
                    }
                    return;
                }
                if (!won) {
                    seq.inRecovery = true;
                    notify(
                        `[ContractSequence] Loss at step ${seq.step} — recovery (${
                            preset.recoveryMode === 'over4' ? 'OVER 4' : 'even×3 / odd×3'
                        })`
                    );
                    return;
                }
            }

            const prev = seq.step;
            seq.step = prev >= preset.stepCount ? 1 : prev + 1;
            notify(`[ContractSequence] [${presetKey}] step ${prev} → ${seq.step}`);
        }

        // ── Rotate market each trade ────────────────────────────────────

        async applyRotateMarketEachTrade() {
            const runs = typeof this.getTotalRuns === 'function' ? this.getTotalRuns() : this.sessionRuns || 0;
            if (!this._marketRotationEachTrade) {
                this._marketRotationEachTrade = { lastRotatedAfterRun: -1 };
            }
            const state = this._marketRotationEachTrade;
            const current = this._dbwCurrentSymbol();
            let idx = VOLATILITY_MARKETS.indexOf(current);
            if (idx < 0) idx = 0;

            if (state.lastRotatedAfterRun < 0) {
                state.lastRotatedAfterRun = runs;
                if (current && VOLATILITY_MARKETS.includes(current)) return true;
                await this._dbwSetMarket(VOLATILITY_MARKETS[idx]);
                return true;
            }
            if (runs <= state.lastRotatedAfterRun) return true;

            const next = VOLATILITY_MARKETS[(idx + 1) % VOLATILITY_MARKETS.length];
            state.lastRotatedAfterRun = runs;
            await this._dbwSetMarket(next);
            notify(`[MarketRotate] Trade #${runs} → ${next}`);
            return true;
        }

        // ── settlement / skip hooks ─────────────────────────────────────

        onDbotwebStrategySettlement(won) {
            this.onOverUnderSwitchSettlement(won);
            this.onOverHunterSettlement(won);
            this.onOverUnderEoSettlement(won);
            this.onRandySettlement(won);
            this.onDbotwebContractSequenceSettlement(won);
        }

        shouldSkipPurchaseForStrategy() {
            const parentSkip =
                typeof super.shouldSkipPurchaseForStrategy === 'function'
                    ? super.shouldSkipPurchaseForStrategy()
                    : Boolean(apolloRuntime.skip_purchase);
            return Boolean(
                parentSkip ||
                    this._overUnderEoBlocked ||
                    this._randyBlocked ||
                    this._evenOddStrategyBlocked ||
                    this._dbwContractSequenceBlocked
            );
        }

        clearStrategyPurchaseSkip() {
            if (typeof super.clearStrategyPurchaseSkip === 'function') {
                super.clearStrategyPurchaseSkip();
            } else {
                apolloRuntime.skip_purchase = false;
            }
            this._overUnderEoBlocked = false;
            this._randyBlocked = false;
            this._evenOddStrategyBlocked = false;
            this._dbwContractSequenceBlocked = false;
        }
    };
