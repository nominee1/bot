import { observer as globalObserver } from '../../../utils/observer';
import { apolloRuntime } from '../utils/apollo-runtime';

const notify = message => {
    try {
        globalObserver.emit('ui.log.notify', { message, className: 'info' });
    } catch {
        // ignore
    }
};

const digitCounts = digits => {
    const counts = Array(10).fill(0);
    digits.forEach(d => {
        if (d >= 0 && d <= 9) counts[d] += 1;
    });
    return counts;
};

const coldestDigit = digits => {
    if (!digits?.length) return 0;
    const counts = digitCounts(digits);
    let coldest = 0;
    for (let i = 1; i < 10; i += 1) {
        if (counts[i] < counts[coldest]) coldest = i;
    }
    return coldest;
};

const digitPct = (digits, digit) => {
    if (!digits?.length) return 0;
    return (digitCounts(digits)[digit] / digits.length) * 100;
};

const allEven = (digits, n) =>
    Boolean(digits?.length) && digits.length >= n && digits.slice(-n).every(d => d % 2 === 0);

const allOdd = (digits, n) => Boolean(digits?.length) && digits.length >= n && digits.slice(-n).every(d => d % 2 === 1);

const VOLATILITY_MARKETS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'];

const SEQUENCE_PRESETS = {
    diff0_over12_streak2: {
        stepCount: 3,
        recoveryOnLoss: true,
        recoveryMode: 'streak',
        recoveryStreakLength: 2,
        labels: { 1: 'DIFFER 0', 2: 'OVER 1', 3: 'OVER 2' },
        steps: { 1: 'differ0', 2: 'over1', 3: 'over2' },
    },
};

const digitConditionPct = (digits, condition, barrier = 0) => {
    if (!digits?.length) return 0;
    const b = Number(barrier) || 0;
    if (condition === 'OVER_PCT') return (digits.filter(d => d > b).length / digits.length) * 100;
    if (condition === 'UNDER_PCT') return (digits.filter(d => d < b).length / digits.length) * 100;
    if (condition === 'EVEN_PCT') return (digits.filter(d => d % 2 === 0).length / digits.length) * 100;
    if (condition === 'ODD_PCT') return (digits.filter(d => d % 2 === 1).length / digits.length) * 100;
    return 0;
};

const clampInt = (value, fallback, min, max) => {
    const n = parseInt(value, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
};

const clampPos = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** MKORUNDER4: hottest digit ≤3, ≥2 of 0–3 at ≥11.5%, last 3 digits all ≥4 */
const matchesMkorUnder4 = digits => {
    if (!digits || digits.length < 15) return false;
    const slice = digits.slice(-15);
    const counts = digitCounts(slice);
    const pct = d => (counts[d] / slice.length) * 100;
    const ranked = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => ({ d, p: pct(d) })).sort((a, b) => b.p - a.p);
    return (
        ranked[0].d <= 3 && [0, 1, 2, 3].filter(d => pct(d) >= 11.5).length >= 2 && slice.slice(-3).every(d => d >= 4)
    );
};

export default Engine =>
    class StrategyControl extends Engine {
        getConsecutiveLosses() {
            return this._consecutiveLosses || 0;
        }

        getConsecutiveWins() {
            return this._consecutiveWins || 0;
        }

        async getDigitsForStrategy(count = 15) {
            const n = Math.max(1, parseInt(count, 10) || 15);
            const digits = await this.getLastDigitList();
            return (digits || []).slice(-Math.max(n, 15));
        }

        setNextContractType(contract_type, prediction) {
            if (!contract_type) return;
            apolloRuntime.contract_switcher = contract_type;
            apolloRuntime.skip_purchase = false;

            if (this.tradeOptions) {
                const next = { ...this.tradeOptions, contract_type };
                if (contract_type === 'DIGITEVEN' || contract_type === 'DIGITODD') {
                    delete next.prediction;
                    delete next.barrier;
                } else if (prediction !== undefined && prediction !== '' && !Number.isNaN(Number(prediction))) {
                    const value = Number(prediction);
                    next.prediction = value;
                    next.barrier = value;
                    this.setPrediction?.(value);
                }
                this.tradeOptions = next;
            } else if (prediction !== undefined && prediction !== '' && !Number.isNaN(Number(prediction))) {
                this.setPrediction?.(Number(prediction));
            }
        }

        setEntryPoint(digit) {
            const value = parseInt(digit, 10);
            const clamped = Number.isNaN(value) ? 0 : Math.min(9, Math.max(0, value));
            this._blocklyEntryPointDigit = clamped;
            if (this.options) this.options.entryPointDigit = clamped;
            notify(`Entry point set to digit ${clamped}`);
        }

        isEntryPointReached() {
            const target = this._blocklyEntryPointDigit ?? this.options?.entryPointDigit;
            if (target == null) {
                notify('Entry point not set — add “set entry point to” under Run once at start');
                return false;
            }
            return this.getLastDigit().then(last => last === Number(target));
        }

        async applyEvenOddTwoStreak() {
            this._evenOddTwoStreakActive = true;
            this._evenOddTwoStreakBlocked = false;
            apolloRuntime.skip_purchase = false;

            let digits = [];
            try {
                digits = await this.getDigitsForStrategy(2);
            } catch {
                digits = [];
            }
            const last2 = digits.slice(-2);
            const label = last2.length ? last2.join('') : '—';

            if (allEven(digits, 2)) {
                this.setNextContractType('DIGITEVEN');
                notify(`[EvenOdd2] Last 2 digits even (${label}) → DIGITEVEN`);
                return true;
            }
            if (allOdd(digits, 2)) {
                this.setNextContractType('DIGITODD');
                notify(`[EvenOdd2] Last 2 digits odd (${label}) → DIGITODD`);
                return true;
            }

            this._evenOddTwoStreakBlocked = true;
            apolloRuntime.skip_purchase = true;
            notify(`[EvenOdd2] Waiting for 2 even or 2 odd in a row (last: ${label})`);
            return false;
        }

        async applyRecoveryBlock() {
            this._recoveryBlockActive = true;
            this._recoveryBlockBlocked = false;
            apolloRuntime.skip_purchase = false;

            if (this.options?.evenOddUnder4Recovery) {
                const losses = this.getConsecutiveLosses();
                this._u8LossCount = Math.max(1, losses || this._u8LossCount || 1);
            }

            let digits = [];
            try {
                digits = await this.getDigitsForStrategy(15);
            } catch {
                digits = [];
            }

            if (matchesMkorUnder4(digits)) {
                this.setNextContractType('DIGITUNDER', 4);
                notify('[RecoveryBlock] MKORUNDER4 → DIGITUNDER 4');
                return true;
            }

            this._recoveryBlockBlocked = true;
            apolloRuntime.skip_purchase = true;
            notify('[RecoveryBlock] Waiting — MKORUNDER4 not ready');
            return false;
        }

        async applyRedBarReverseMatches() {
            this._redBarReverseMatchesActive = true;
            this._redBarReverseMatchesBlocked = false;
            apolloRuntime.skip_purchase = false;

            let digits = [];
            try {
                digits = await this.getDigitsForStrategy(100);
            } catch {
                digits = [];
            }

            if (digits.length < 15) {
                this._redBarReverseMatchesBlocked = true;
                apolloRuntime.skip_purchase = true;
                notify(`[RedBarMATCHES] Need 15+ ticks (have ${digits.length})`);
                return false;
            }

            const last = digits[digits.length - 1];
            const prev = digits.slice(0, -1);
            const red = coldestDigit(digits);
            const prevRed = coldestDigit(prev);
            const redPctNow = digitPct(digits, red);
            const redPctPrev = digitPct(prev, red);
            const sameRed = red === prevRed;
            const rising = redPctNow > redPctPrev;
            const entryHit = last === red;

            if (sameRed && rising && entryHit) {
                this.setNextContractType('DIGITMATCH', red);
                notify(
                    `[RedBarMATCHES] DIGITMATCH ${red} — red bar ${redPctNow.toFixed(1)}% (↑${redPctPrev.toFixed(1)}%), entry tick=${last}`
                );
                return true;
            }

            this._redBarReverseMatchesBlocked = true;
            apolloRuntime.skip_purchase = true;
            const reasons = [
                !sameRed && `red bar shifted ${prevRed}→${red}`,
                !rising && `red % flat/falling ${redPctPrev.toFixed(1)}%→${redPctNow.toFixed(1)}%`,
                !entryHit && `last tick ${last} ≠ red bar ${red}`,
            ]
                .filter(Boolean)
                .join(' | ');
            notify(`[RedBarMATCHES] Waiting — ${reasons}`);
            return false;
        }

        /** Recovery-mode dropdown (trade_definition PARAM_LABEL) — mutates contract before buy. */
        applyRecoveryModeToContract(contract_type) {
            const options = this.options || {};
            const losses = this.getConsecutiveLosses();
            this._u8LossCount = losses;

            if (
                options.evenOddUnder4Recovery &&
                (contract_type === 'DIGITEVEN' || contract_type === 'DIGITODD') &&
                losses >= 1
            ) {
                this.setNextContractType('DIGITUNDER', 4);
                notify(`Under4 recovery — DIGITUNDER 4 after ${losses} loss(es)`);
                return 'DIGITUNDER';
            }

            if (
                options.proRecoveryEnabled &&
                (contract_type === 'DIGITUNDER' || contract_type === 'DIGITOVER' || contract_type === 'DIGITDIFF') &&
                losses >= 1
            ) {
                // Stage-style recovery: after losses, prefer UNDER with barrier 4
                this.setNextContractType('DIGITUNDER', 4);
                notify(`Pro recovery — DIGITUNDER 4 after ${losses} loss(es)`);
                return 'DIGITUNDER';
            }

            if (options.differOverRecovery && contract_type === 'DIGITDIFF' && losses >= 1) {
                this.setNextContractType('DIGITOVER', 2);
                notify(`Differ/Over recovery — DIGITOVER 2 after ${losses} loss(es)`);
                return 'DIGITOVER';
            }

            if (
                options.evenOddUnder5ChartlordRecovery &&
                (contract_type === 'DIGITEVEN' || contract_type === 'DIGITODD') &&
                losses >= 1
            ) {
                this.setNextContractType('DIGITUNDER', 5);
                notify(`Under5 ChartLord recovery — DIGITUNDER 5 after ${losses} loss(es)`);
                return 'DIGITUNDER';
            }

            return contract_type;
        }

        shouldSkipPurchaseForStrategy() {
            return Boolean(
                apolloRuntime.skip_purchase ||
                    this._evenOddTwoStreakBlocked ||
                    this._recoveryBlockBlocked ||
                    this._redBarReverseMatchesBlocked ||
                    this._contractSequenceBlocked ||
                    this._conceptBlockBlocked
            );
        }

        clearStrategyPurchaseSkip() {
            apolloRuntime.skip_purchase = false;
            this._evenOddTwoStreakBlocked = false;
            this._recoveryBlockBlocked = false;
            this._redBarReverseMatchesBlocked = false;
            this._contractSequenceBlocked = false;
            this._conceptBlockBlocked = false;
        }

        getCurrentSymbol() {
            return this.tradeOptions?.symbol || this.options?.symbol || '';
        }

        async setMarket(symbol) {
            if (!symbol || !this.tradeOptions) return;
            this.tradeOptions = { ...this.tradeOptions, symbol };
            if (this.options) this.options.symbol = symbol;
            if (typeof this.updateWorkspaceSymbol === 'function') {
                await this.updateWorkspaceSymbol(symbol);
            }
            notify(`[Market] Switched to ${symbol}`);
        }

        async rotateToNextVolatilityMarket() {
            const current = this.getCurrentSymbol();
            const idx = VOLATILITY_MARKETS.indexOf(current);
            const next = VOLATILITY_MARKETS[idx >= 0 ? (idx + 1) % VOLATILITY_MARKETS.length : 0];
            await this.setMarket(next);
        }

        async applyContractSequenceDiff0Over12Streak2() {
            return this.applyContractSequencePreset('diff0_over12_streak2');
        }

        async applyContractSequencePreset(presetKey = 'diff0_over12_streak2') {
            const preset = SEQUENCE_PRESETS[presetKey] || SEQUENCE_PRESETS.diff0_over12_streak2;
            if (!this._contractSeq || this._contractSeq.preset !== presetKey) {
                this._contractSeq = { step: 1, preset: presetKey, inRecovery: false, _recoveryFired: false };
            }
            this._contractSequenceActive = true;
            this._contractSequenceBlocked = false;
            apolloRuntime.skip_purchase = false;

            let digits = [];
            try {
                digits = await this.getDigitsForStrategy(15);
            } catch {
                digits = [];
            }

            if (preset.recoveryOnLoss && this._contractSeq.inRecovery) {
                const n = preset.recoveryStreakLength || 2;
                if (digits.length < n) {
                    this._contractSequenceBlocked = true;
                    apolloRuntime.skip_purchase = true;
                    notify(`[ContractSequence] RECOVERY: need ${n} ticks`);
                    return false;
                }
                const label = digits.slice(-n).join('');
                if (allEven(digits, n)) {
                    this.setNextContractType('DIGITEVEN');
                    this._contractSeq._recoveryFired = true;
                    this._contractSequenceAwaitingSettlement = true;
                    notify(`[ContractSequence] RECOVERY: ${n} even (${label}) → DIGITEVEN`);
                    return true;
                }
                if (allOdd(digits, n)) {
                    this.setNextContractType('DIGITODD');
                    this._contractSeq._recoveryFired = true;
                    this._contractSequenceAwaitingSettlement = true;
                    notify(`[ContractSequence] RECOVERY: ${n} odd (${label}) → DIGITODD`);
                    return true;
                }
                this._contractSequenceBlocked = true;
                apolloRuntime.skip_purchase = true;
                notify(`[ContractSequence] RECOVERY: waiting ${n} even/odd (last: ${label || '—'})`);
                return false;
            }

            const step = this._contractSeq.step;
            const action = preset.steps[step];
            if (action === 'differ0') this.setNextContractType('DIGITDIFF', 0);
            else if (action === 'over1') this.setNextContractType('DIGITOVER', 1);
            else if (action === 'over2') this.setNextContractType('DIGITOVER', 2);
            else {
                this._contractSeq.step = 1;
                return this.applyContractSequencePreset(presetKey);
            }
            this._contractSequenceAwaitingSettlement = true;
            notify(`[ContractSequence] [${presetKey}] Step ${step}: ${preset.labels[step]}`);
            return true;
        }

        advanceContractSequence(won) {
            if (!this._contractSequenceActive || !this._contractSeq) return;
            const presetKey = this._contractSeq.preset || 'diff0_over12_streak2';
            const preset = SEQUENCE_PRESETS[presetKey];
            if (!preset) return;
            this._contractSequenceAwaitingSettlement = false;
            this._contractSequenceBlocked = false;

            if (preset.recoveryOnLoss) {
                if (this._contractSeq.inRecovery) {
                    if (this._contractSeq._recoveryFired && won) {
                        this._contractSeq.inRecovery = false;
                        this._contractSeq._recoveryFired = false;
                        this._contractSeq.step = 1;
                        notify(`[ContractSequence] Recovery won — resume at step 1`);
                    } else if (this._contractSeq._recoveryFired && !won) {
                        this._contractSeq._recoveryFired = false;
                        notify('[ContractSequence] Recovery loss — wait for streak again');
                    }
                    return;
                }
                if (!won) {
                    this._contractSeq.inRecovery = true;
                    notify(`[ContractSequence] Loss at step ${this._contractSeq.step} — recovery`);
                    return;
                }
            }

            const prev = this._contractSeq.step;
            this._contractSeq.step = prev >= preset.stepCount ? 1 : prev + 1;
            notify(`[ContractSequence] step ${prev} → ${this._contractSeq.step}`);
        }

        onConceptBlockSettlement(won) {
            if (!this._conceptBlockActive) return;
            if (!won) {
                this._conceptCooldownRemaining = this._conceptCooldownTicks ?? 3;
                this._conceptBelowCount = 0;
                return;
            }
            const lockAt = this._conceptWinStreakLock ?? 3;
            const wins = this._consecutiveWins || 0;
            if (lockAt > 0 && wins >= lockAt) {
                this._conceptLockRemaining = 5;
                this._conceptLockThreshold = this._conceptConfiguredLockThreshold ?? 80;
            }
        }

        async applyConceptBlock(
            tickCount = 15,
            threshold = 70,
            overBarrier = 2,
            underBarrier = 7,
            waitBeforeScan = 5,
            cooldown = 3,
            winStreakLock = 3,
            lockThreshold = 80
        ) {
            this._conceptBlockActive = true;
            this._conceptBlockBlocked = false;
            apolloRuntime.skip_purchase = false;

            const ticks = clampInt(tickCount, 15, 1, 1000);
            const thr = clampPos(threshold, 70);
            const overB = clampInt(overBarrier, 2, 0, 9);
            const underB = clampInt(underBarrier, 7, 0, 9);
            const waitScan = clampInt(waitBeforeScan, 5, 1, 100);
            const cool = clampInt(cooldown, 3, 0, 100);
            const winLock = clampInt(winStreakLock, 3, 0, 50);
            const lockThr = clampPos(lockThreshold, 80);

            this._conceptCooldownTicks = cool;
            this._conceptWinStreakLock = winLock;
            this._conceptConfiguredLockThreshold = lockThr;

            if ((this._conceptCooldownRemaining || 0) > 0) {
                this._conceptCooldownRemaining -= 1;
                this._conceptBlockBlocked = true;
                apolloRuntime.skip_purchase = true;
                return false;
            }

            let digits = [];
            try {
                digits = await this.getDigitsForStrategy(ticks);
            } catch {
                digits = [];
            }
            if (digits.length < ticks) {
                this._conceptBlockBlocked = true;
                apolloRuntime.skip_purchase = true;
                return false;
            }

            const overPct = digitConditionPct(digits, 'OVER_PCT', overB);
            const underPct = digitConditionPct(digits, 'UNDER_PCT', underB);
            notify(`${Math.max(overPct, underPct).toFixed(1)}%`);

            let activeThr = thr;
            if ((this._conceptLockRemaining || 0) > 0) {
                activeThr = this._conceptLockThreshold ?? lockThr;
                this._conceptLockRemaining -= 1;
            }

            const last = digits[digits.length - 1];
            const takeOver = overPct >= activeThr && last > overB;
            const takeUnder = underPct >= activeThr && last < underB;
            if (takeOver && (!takeUnder || overPct >= underPct)) {
                this.setNextContractType('DIGITOVER', overB);
                this._conceptBelowCount = 0;
                return true;
            }
            if (takeUnder) {
                this.setNextContractType('DIGITUNDER', underB);
                this._conceptBelowCount = 0;
                return true;
            }

            if (!(overPct >= activeThr || underPct >= activeThr)) {
                this._conceptBelowCount = (this._conceptBelowCount || 0) + 1;
                if (this._conceptBelowCount >= waitScan) {
                    this._conceptBelowCount = 0;
                    await this.rotateToNextVolatilityMarket();
                }
            }

            this._conceptBlockBlocked = true;
            apolloRuntime.skip_purchase = true;
            return false;
        }
    };
