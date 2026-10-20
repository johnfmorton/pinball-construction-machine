<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::view('/', 'play')->name('play');
Route::view('/editor', 'editor')->name('editor');

Route::get('/lab', function () {
    abort_unless(config('pcm.lab_public'), 404);

    return view('lab');
})->name('lab');

// The pages were static .html files before Laravel; keep old links (and their
// ?table= query) working.
foreach (['editor', 'lab'] as $page) {
    Route::get("/{$page}.html", function (Request $request) use ($page) {
        $query = $request->getQueryString();

        return redirect("/{$page}".($query ? "?{$query}" : ''), 301);
    });
}
