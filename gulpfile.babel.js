// @flow weak

import glob from 'glob';
import es from 'event-stream';
import fs from 'fs';
import path from 'path';

import gulp from 'gulp';
import gulpLoadPlugins from 'gulp-load-plugins';
import del from 'del';
import runSequence from 'run-sequence';
import {stream as wiredep} from 'wiredep';
import browserify from 'browserify';
import buffer from 'vinyl-buffer';
import source from 'vinyl-source-stream';
import babelify from 'babelify';
import watchify from 'watchify';
import sass from 'gulp-sass';

const $ = gulpLoadPlugins();
const extraTargets = [
  'app/*.*',
  'app/_locales/**',
  'app/styles/*.css',
  '!app/scripts',
  '!app/*.html'
];
let watching = false;

gulp.task('extras', () => {
  return gulp.src(extraTargets, {
    base: 'app',
    dot: true
  }).pipe(gulp.dest('dist'));
});

function lint(files, options) {
  return () => {
    return gulp.src(files)
      .pipe($.eslint(options))
      .pipe($.eslint.format());
  };
}

function buildJS(watch: boolean, done: Function) {
  glob('./app/scripts/*.js', (err: Error, files: string[]) => {
    if (err) {
      done(err);
    }

    const tasks = files.map((entry: string) => {
      const b = browserify({
        entries: [entry],
        extensions: ['.js'],
        debug: watch,
        cache: {},
        packageCache: {},
        fullPaths: true
      })
      .transform(babelify, { sourceMaps: true, sourceMapsAbsolute: false })
      .on('error', function(err){
        console.error(err.message);
        this.emit('end');
      });

      if (watch) {
        b.plugin(watchify);
      }

      const bundle = () => {
        if (watch) {
          console.log('Rebundling:', entry);
        }

        const s = b.bundle()
          .on('error', function(err){
            console.error(err.message);
            this.emit('end');
          })
          .pipe(source(path.basename(entry)))
          .pipe(buffer())
          // .pipe($.if(watch, $.sourcemaps.init({ loadMaps: true })))
          // .pipe($.if(watch, $.sourcemaps.write('./')))
          .pipe($.if(!watch, $.uglify()))
          .pipe(gulp.dest('dist/scripts'));

        if (watch) {
          s.on('end', () => console.log('Done rebundling:', entry));
        }

        return s;
      };

      if (watch) {
        b.on('update', bundle);
      }

      return bundle();
    });

    es.merge(tasks).on('end', () => {
      done();
    });
  });
}

gulp.task('watch', (done) => {
  gulp.watch('app/styles/**/*.scss', ['sass']);
  gulp.watch(extraTargets, ['extras']);
  gulp.watch('app/*.html', ['html']);
  gulp.watch('app/images/**/*', ['images']);
  buildJS(true, done);
});

gulp.task('lint', lint('app/scripts/**/*.js'));

gulp.task('sass', function() {
  return gulp.src('app/styles/**/*.scss')
    .pipe($.sourcemaps.init())
    .pipe(sass().on('error', sass.logError))
    .pipe($.sourcemaps.write())
    .pipe(gulp.dest('dist/styles'));
});

gulp.task('images', () => {
  return gulp.src('app/images/**/*')
    .pipe($.if($.if.isFile, $.cache($.imagemin({
      progressive: true,
      interlaced: true,
      // don't remove IDs from SVGs, they are often used
      // as hooks for embedding and styling
      svgoPlugins: [{cleanupIDs: false}]
    }))
    .on('error', function (err) {
      console.log(err);
      this.end();
    })))
    .pipe(gulp.dest('dist/images'));
});

gulp.task('html',  () => {
  return gulp.src('app/*.html')
    .pipe($.useref({searchPath: ['.tmp', 'app', '.']}))
    .pipe($.sourcemaps.init())
    .pipe($.if('*.js', $.uglify()))
    .pipe($.if('*.css', $.cleanCss({compatibility: '*'})))
    .pipe($.sourcemaps.write())
    .pipe($.if('*.html', $.htmlmin({removeComments: true, collapseWhitespace: true})))
    .pipe(gulp.dest('dist'));
});

gulp.task('js', (done) => {
  buildJS(false, done);
});

gulp.task('clean', del.bind(null, ['.tmp', 'dist']));

gulp.task('size', () => {
  return gulp.src('dist/**/*').pipe($.size({title: 'build', gzip: true}));
});

gulp.task('wiredep', () => {
  gulp.src('app/*.html')
    .pipe(wiredep({
      ignorePath: /^(\.\.\/)*\.\./
    }))
    .pipe(gulp.dest('app'));
});

gulp.task('package', function () {
  var manifest = JSON.parse(fs.readFileSync('./dist/manifest.json').toString());
  return gulp.src('dist/**')
    .pipe($.zip('Floodwatch-' + manifest.version + '.zip'))
    .pipe(gulp.dest('package'));
});

gulp.task('build', ['clean'], (cb) => {
  runSequence(
    'lint', 'js',
    ['html', 'images', 'extras', 'sass'],
    'size', cb);
});

gulp.task('default', ['clean'], cb => {
  runSequence('build', cb);
});
