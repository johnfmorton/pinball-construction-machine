<!doctype html>
<html lang="en">
  <head>
    @include('partials.head', ['title' => 'Table Editor · Pinball Construction Machine'])
    @vite('src/editor/main.ts')
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>
