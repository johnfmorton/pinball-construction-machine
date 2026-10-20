<?php

return [

    /*
    | Whether the Physics Lab (/lab) is open to everyone. When it's off, the
    | route 404s and the pages hide their links to it. Once tables are saved
    | on the server, each table can also opt out of being opened in the lab.
    */

    'lab_public' => (bool) env('PCM_LAB_PUBLIC', true),

];
