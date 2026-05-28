<?php
// api/BinarykePlans.php
declare(strict_types=1);

final class BinarykePlans {
    public static function get(string $planId): array {
        $plans = [
            'standard_6m'  => ['plan_id' => 'standard_6m',  'months' => 6,  'amount' => 15.0, 'currency' => 'USD'],
            'standard_12m' => ['plan_id' => 'standard_12m', 'months' => 12, 'amount' => 25.0, 'currency' => 'USD'],
        ];

        if (!isset($plans[$planId])) {
            throw new RuntimeException('Invalid plan_id');
        }
        return $plans[$planId];
    }
}
