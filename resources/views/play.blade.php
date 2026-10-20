<!doctype html>
<html lang="en">
  <head>
    @include('partials.head', ['title' => 'Pinball Construction Machine'])
    @vite(['src/play/style.css', 'src/play/main.ts'])
  </head>
  <body>
    <canvas id="view"></canvas>

    <div id="dmd" aria-live="polite">
      <div id="dmd-score">0</div>
      <div id="dmd-line"><span id="dmd-ball">PRESS S TO START</span><span id="dmd-mult"></span></div>
    </div>

    <div id="message" hidden></div>

    <nav id="corner">
      <a id="link-editor" href="{{ route('editor') }}" title="Build and edit tables">Editor</a>
      @if (config('pcm.lab_public'))
        <a id="link-lab" href="{{ route('lab') }}" title="Open the 2D physics lab">Physics Lab</a>
      @endif
      <select id="table-select" aria-label="Table"></select>
      <select id="theme-select" aria-label="Playfield theme">
        <option value="midnight">Midnight</option>
        <option value="sunset">Sunset Strip</option>
        <option value="classic">Classic 1977</option>
      </select>
      <select id="quality-select" aria-label="Graphics quality">
        <option value="auto">Quality: Auto</option>
        <option value="high">Quality: High</option>
        <option value="medium">Quality: Medium</option>
        <option value="low">Quality: Low</option>
      </select>
      <span id="fps"></span>
    </nav>

    <div id="help">
      <kbd>S</kbd> start · <kbd>Z</kbd>/<kbd>⇧</kbd> left flipper · <kbd>/</kbd>/<kbd>⇧</kbd> right flipper · hold <kbd>Enter</kbd> plunger ·
      <kbd>Space</kbd> <kbd>Q</kbd> <kbd>E</kbd> nudge · <kbd>P</kbd> pause · <kbd>M</kbd> sound · <kbd>H</kbd> hide
    </div>
  </body>
</html>
