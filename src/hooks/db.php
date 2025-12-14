<?php
/* db.php – require this file from any endpoint needing DB access */
$pdo = new PDO(
    'mysql:host=localhost;dbname=denavwig_derivuser;charset=utf8mb4',
    'denavwig_oti',
    'bebina1@N',
    [ PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION ]
);
