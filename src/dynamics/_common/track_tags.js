Scoped.define("module:TrackTags", [
    "base:Class",
    "base:Objs",
    "base:Events.EventsMixin",
    "base:Async",
    "base:Types",
    "base:TimeFormat",
    "browser:Dom",
    "browser:Info",
    "browser:Events"
], function(Class, Objs, EventsMixin, Async, Types, TimeFormat, Dom, Info, DomEvents, scoped) {
    return Class.extend({
        scoped: scoped
    }, [EventsMixin, function(inherited) {
        return {

            /**
             * @param {Object} options
             * @param {Object} dynamics
             */
            constructor: function(options, dynamics) {
                this._dyn = dynamics;
                this._video = dynamics.__video;
                this.init(options);
            },

            init: function(options) {
                options = options || {};
                this._chapters = [];
                this._trackTags = this._dyn.get("tracktags");
                this._chapterLoadedTriggered = false;
                this.hasThumbs = false;
                this._autoEnabledTrackTags = options.autoenabledtracktags || this._dyn.get("autoenabledtracktags") || [];

                this._dyn.set("tracktagssupport", this._trackTags && this._trackTags.length > 0 &&
                    ('track' in document.createElement('track')));
                if (!(this._video instanceof HTMLMediaElement) || !this._trackTags || this._trackTags.length === 0) {
                    return null;
                }
                this._loadTrackTags();
                // To be able to play default subtitle in with custom style
                if (this._dyn.get("tracktagsstyled")) this._setDefaultTrackOnPlay();

                // Will trigger meta tag on-load event
                Async.eventually(function() {
                    this._loadMetaTrackTags();
                }, this);
            },

            /**
             * Will show thumb on duration
             * @param {int} index
             * @param {int} fromLeft
             * @param {int} currentDuration
             */
            showDurationThumb: function(index, fromLeft, currentDuration) {
                if (this._dyn.get("thumbcuelist")[index]) {
                    var _cue = this._dyn.get("thumbcuelist")[index];
                    var _time = currentDuration || (_cue.startTime + Math.round((_cue.startTime - _cue.endTime) / 2));
                    var _thumbContainer = this.thumbContainer;
                    var _thumbImage = _thumbContainer.querySelector('div');
                    var _timeContainer = _thumbContainer.querySelector('span');
                    var _left = fromLeft - Math.round(_cue.thumbWidth / 1.5) <= 0 ? 5 : fromLeft - Math.round(_cue.thumbWidth / 1.5);
                    _thumbContainer.style.opacity = '0.85';
                    _thumbContainer.style.left = _left + "px";
                    _thumbImage.style.backgroundPositionX = "-" + _cue.positionX + "px";
                    _thumbImage.style.backgroundPositionY = "-" + _cue.positionY + "px";
                    _timeContainer.innerText = _time > 0 ? TimeFormat.format(TimeFormat.ELAPSED_MINUTES_SECONDS, _time * 1000) : '0:00';
                }
            },

            /**
             * Will hide thumbnail container
             */
            hideDurationThumb: function() {
                this.thumbContainer.style.opacity = '0.00';
            },

            /**
             * Appear track elements inside video element
             * @private
             */
            _loadTrackTags: function() {
                if (!this._dyn.get("tracktagssupport")) return;

                const prevTrackElements = this._video?.querySelectorAll('track');
                if (prevTrackElements && prevTrackElements.length > 0) {
                    prevTrackElements.forEach(tr => this._video.removeChild(tr));
                }

                Objs.iter(this._trackTags, function(subtitle, index) {
                    const _trackTag = document.createElement("track");
                    const _domEvent = this.auto_destroy(new DomEvents());

                    /** kind could be on of the: subtitles, captions, descriptions, chapters, metadata */
                    try {
                        if (subtitle.content && !subtitle.src) {
                            if (Types.is_object(subtitle.content)) {
                                _trackTag.src = URL.createObjectURL(new Blob([
                                    this.generateVTTFromObject(subtitle.content)
                                ], {
                                    type: 'text/vtt'
                                }));
                            } else {
                                _trackTag.src = URL.createObjectURL(new Blob([subtitle.content], {
                                    type: 'text/plain'
                                }));
                            }
                        }
                    } catch (e) {
                        console.warn(e);
                    }

                    subtitle.enabled = this._autoEnabledTrackTags.includes(subtitle.kind);
                    switch (subtitle.kind) {
                        case 'thumbnails':
                            _trackTag.id = this._dyn.get("css") + '-track-thumbnails';
                            _trackTag.kind = 'metadata';
                            if (!_trackTag.src) _trackTag.src = subtitle.src || null;
                            _trackTag.mode = 'hidden';
                            this.__appendThumbnailTrackTags(subtitle, index, _trackTag, _domEvent);
                            break;
                        case 'chapters':
                            _trackTag.id = this._dyn.get("css") + '-track-chapters';
                            _trackTag.kind = 'chapters';
                            _trackTag.src = subtitle.src;
                            _trackTag.mode = 'hidden';
                            this.__appendChaptersTrackTags(subtitle, index, _trackTag, _domEvent);
                            break;
                        default: // Will be subtitles, as mostly it's using for this purpose
                            _trackTag.id = this._dyn.get("css") + '-tack-' + index;
                            _trackTag.kind = subtitle.kind || 'subtitles';
                            _trackTag.label = subtitle.label || 'English';
                            _trackTag.srclang = subtitle.lang || 'en';
                            if (!_trackTag.src) _trackTag.src = subtitle.src || null;
                            if (this._dyn.get(`tracktextvisible`)) subtitle.enabled = true;
                            this._dyn.set("hassubtitles", true);
                            this.__appendTextTrackTags(subtitle, index, _trackTag, _domEvent);
                            if (this._trackTags.length > 1) {
                                this._dyn.on("switch-track", function(selectedTrack) {
                                    this._dyn.set("tracktextvisible", true);
                                    this._dyn.set("trackcuetext", null);
                                    this._setSelectedTag(selectedTrack);
                                }, this);
                            }
                            break;
                    }
                    this._video.appendChild(_trackTag);
                }, this);
            },

            /**
             * @param {object} content
             * @param {number | undefined } presetTimePeriod
             * @return {string}
             * @private
             */
            generateVTTFromObject: function(content, presetTimePeriod) {
                presetTimePeriod = presetTimePeriod || 2;

                const timeKey = 'times';
                const wordsKey = 'words';

                if (!content || !Types.is_object(content))
                    throw new Error(`No content provided for tracktags subtitles content. Expected format: "{content: {${wordsKey}: [], ${timeKey}: [{start: number, end: number}]}}"`);

                if (!content[wordsKey] || !content[timeKey] || (content[timeKey] && (!Types.isNumber(content[timeKey][0]?.end) || !Types.isNumber(content[timeKey][0]?.start)))) {
                    throw new Error(`Please provide correct format for tracktags subtitles content object. Expected format: {${wordsKey}: [], ${timeKey}: [{start: number, end: number}]}`);
                }

                const [words, times] = [content[wordsKey], content[timeKey]];

                let wordsForCurrentPeriod = '';
                let vttContent = "WEBVTT";
                let startTime = times[0].start;
                let lineNumber = 1;
                // const wordRegex = /\w|\b[.,!?;:]/g;
                const singleCharacterRegex = /^[,.?;:!]$/gim;
                const wordEndedWithCharacterRegex = /\b[.,!?;:]/g;

                Objs.iter(words, (text, i) => {
                    const singleCharacter = singleCharacterRegex.test(text);
                    const endTime = times[i].end;
                    if (!startTime) startTime = times[i].start;
                    if (startTime >= 0 && endTime >= 0 && Types.is_string(text) && text.length > 0) {
                        // add space only if it's not special character (\b[.,!?;:] => \b assert position at a word boundary)
                        if (wordsForCurrentPeriod.length > 0) {
                            text = singleCharacter ? text : (' ' + text);
                        } else if (singleCharacter) {
                            // if the text only contains as special characters like dot.
                            vttContent += text;
                            wordsForCurrentPeriod = '';
                            return;
                        }
                        wordsForCurrentPeriod += text;
                        if (endTime > startTime + presetTimePeriod * 1000 || (wordsForCurrentPeriod.length > 15 && wordEndedWithCharacterRegex.test(wordsForCurrentPeriod))) {
                            // add space only if it's not special character, alt: new Date(endTime).toISOString().slice(11, 23);
                            const endTimeAsText = TimeFormat.format("HH:MM:ss.l", endTime);
                            const startTimeAsText = TimeFormat.format("HH:MM:ss.l", startTime);
                            vttContent += `\n\n${lineNumber}\n${startTimeAsText} --> ${endTimeAsText}\n${wordsForCurrentPeriod.trim()}`;

                            lineNumber++;
                            startTime = null;
                            wordsForCurrentPeriod = '';
                        }
                    }
                }, this);

                // Add the last time period if it has any words
                if (wordsForCurrentPeriod.length > 0) {
                    vttContent += `\n\n${lineNumber++}\n${TimeFormat.format("HH:MM:ss.l", startTime)} --> ${TimeFormat.format("HH:MM:ss.l", times[times.length - 1].end)}\n${wordsForCurrentPeriod.trim()}`;
                }

                return vttContent;
            },

            /**
             * Reload track tags
             * @return {null}
             */
            reload: function(options) {
                this._dyn.set("trackcuetext", null);
                this.init();
            },

            destroy: function() {
                inherited.destroy.call(this);
            },

            __detectTrackTagFormat: function(data) {
                // Trim leading/trailing white space and get the first line
                const firstLine = data.trim().split('\n')[0];

                // Check if the first line is "WEBVTT"
                if (firstLine === "WEBVTT") {
                    return "VTT";
                }

                // If the first line is a number, it's likely an SRT file
                if (!isNaN(firstLine) && Number(firstLine) > 0) {
                    return "SRT";
                }

                // If it's neither, we don't know the format
                return "Unknown";
            },

            /**
             *
             * @param {Object} subtitle
             * @param {Integer} index
             * @param {HTMLElement} trackTag
             * @param {EventListenerOrEventListenerObject} domEvent
             * @private
             */
            __appendTextTrackTags: function(subtitle, index, trackTag, domEvent) {
                if (subtitle.enabled) {
                    trackTag.default = true;
                    this._dyn.set("tracktaglang", subtitle.lang);
                    this._dyn.set("tracktextvisible", true);
                }
                trackTag.setAttribute('data-selector', 'track-tag');
                domEvent.on(trackTag, "load", function(ev) {
                    const {
                        target
                    } = ev;
                    const {
                        track
                    } = target;
                    const elModeStatus = (subtitle.enabled && !this._dyn.get("tracktagsstyled")) ? 'showing' : 'hidden';
                    target.mode = elModeStatus;
                    if (this._video) {
                        // Firefox
                        this._video.textTracks[index].mode = elModeStatus;
                    }
                    if (this._dyn.get("tracktagsstyled") && subtitle.enabled) {
                        this._showTracksInCustomElement(track, subtitle.lang);
                    }
                }, this);
            },

            /**
             *
             * @param {Object} subtitle
             * @param {Integer} index
             * @param {HTMLElement} trackTag
             * @param {EventListenerOrEventListenerObject} domEvent
             * @private
             */
            __appendChaptersTrackTags: function(subtitle, index, trackTag, domEvent) {
                const _self = this;
                let _track, _cues;
                trackTag.setAttribute('data-selector', 'chapters-track-tag');
                domEvent.on(trackTag, "load", function(ev) {
                    this.hasChapters = true;
                    _track = this.track;
                    _cues = _track.cues;
                    if (!_cues)
                        console.warn('Provided source for the chapters is not correct');
                    else
                        _self.__generateChapters(_cues);
                });
            },

            /**
             *
             * @param {Object} subtitle
             * @param {Integer} index
             * @param {HTMLElement} trackTag
             * @param {EventListenerOrEventListenerObject} domEvent
             * @private
             */
            __appendThumbnailTrackTags: function(subtitle, index, trackTag, domEvent) {
                const _self = this;
                let _track, _image, _splitText, _dimensions, thumbLink;
                trackTag.setAttribute('data-selector', 'thumb-track-tag');
                domEvent.on(trackTag, "load", function(ev) {
                    _track = this.track;
                    if (_track.cues[0].text) {
                        _splitText = _track.cues[0].text.split('#xywh=');
                        thumbLink = _splitText[0];
                        _dimensions = _track.cues[0].text.split('#xywh=')[1].split(',');

                        _image = new Image();
                        _image.src = thumbLink;

                        domEvent.on(_image, "load", function() {
                            this.hasThumbs = true;

                            var _thumbContainer = document.createElement('div');
                            var _thumbImageContainer = document.createElement('div');
                            var _timeContainer = document.createElement('span');

                            Dom.elementAddClass(_thumbContainer, this._dyn.get('css') + '-seeking-thumb-container');

                            _thumbContainer.style.opacity = '0.00';
                            _thumbImageContainer.style.height = +(_dimensions[3]) + 'px';
                            _thumbImageContainer.style.width = +(_dimensions[2]) + 'px';
                            _thumbImageContainer.style.backgroundImage = "url('" + thumbLink + "')";
                            _thumbImageContainer.style.backgroundRepeat = 'no-repeat';
                            _thumbImageContainer.style.backgroundAttachment = 'background-attachment';

                            _thumbContainer.appendChild(_thumbImageContainer);
                            _thumbContainer.appendChild(_timeContainer);

                            this._dyn.set("thumbimage", {
                                image: _image,
                                url: _image.src,
                                height: _image.naturalHeight || _image.height,
                                width: _image.naturalWidth || _image.width,
                                thumbWidth: Number(_dimensions[2]),
                                thumbHeight: Number(_dimensions[3])
                            });
                            this.thumbContainer = _thumbContainer;
                            this.__generateThumbnails(_track);
                        }, _self);
                    }
                });
            },

            /**
             * Generate
             * @param {Object} track
             * @private
             */
            __generateThumbnails: function(track) {
                Objs.iter(track.cues, function(cue, index) {
                    if (typeof cue === 'object') {
                        var _lineSplit = cue.text.trim().split('#xywh=')[1];
                        var _coordinates = _lineSplit.split(',');
                        // this here is main DYN instance
                        this.get("thumbcuelist").push({
                            startTime: cue.startTime,
                            endTime: cue.endTime,
                            positionX: _coordinates[0],
                            positionY: _coordinates[1],
                            thumbWidth: _coordinates[2],
                            thumbHeight: _coordinates[3]
                        });
                    }
                }, this._dyn);
            },

            /**
             * Generate
             * @param {Object} cues
             * @private
             */
            __generateChapters: function(cues) {
                Objs.iter(cues, function(cue, index) {
                    if (typeof cue === 'object') {
                        // this here is main Player Dynamics instance
                        this._chapters.push({
                            index: index,
                            startTime: cue.startTime,
                            endTime: cue.endTime,
                            title: cue.text
                        });
                    }
                    if (cues.length === this._chapters.length && !this._chapterLoadedTriggered) {
                        this._dyn.trigger("chaptercuesloaded", this._chapters, cues.length);
                        this._chapterLoadedTriggered = true;
                    }
                }, this);
            },

            /**
             * If custom styled text track selected
             * @param {Object} track
             * @param {String} lang
             * @private
             */
            _showTracksInCustomElement: function(track, lang) {
                const _lang = lang || this._dyn.get("tracktaglang");
                if (track.language === _lang && track.cues) {
                    track.mode = this._dyn.get("tracktagsstyled") ? `hidden` : `showing`;
                    if (track.mode === 'hidden') track.enabled = false;
                    Objs.iter(track.cues, function(cue) {
                        if (typeof cue === 'object') {
                            cue.onenter = (ev) => {
                                const {
                                    target
                                } = ev;
                                if (this._dyn.get("tracktagsstyled")) {
                                    const _currentTime = this._video.currentTime;
                                    if (target.startTime < _currentTime && target.endTime > _currentTime) {
                                        this._dyn.set("trackcuetext", target.text);
                                    }
                                } else {
                                    track.mode = `showing`;
                                }
                            };
                            cue.onexit = (ev) => {
                                this._dyn.set("trackcuetext", null);
                            };
                        }
                    }, this);
                }
            },

            /**
             * Load meta data kind Track Elements
             * @private
             */
            _loadMetaTrackTags: function() {
                if (this._video) {
                    Objs.iter(this._video.textTracks, function(track, index) {
                        if (typeof this._video.textTracks[index] === 'object' && this._video.textTracks[index]) {
                            const _track = this._video.textTracks[index];
                            // If set custom style to true show cue text in our element
                            if (_track.kind === 'metadata') _track.mode = 'hidden';
                            if (_track.kind === 'chapters') _track.mode = 'showing';
                        }
                    }, this);
                }
            },

            /**
             * Will set default language text track
             * @private
             */
            _setDefaultTrackOnPlay: function() {
                Objs.iter(this._trackTags, function(track, index) {
                    const trackElement = this._video.textTracks[index];
                    if (typeof trackElement === 'object' && trackElement) {
                        if (trackElement.mode === 'showing') {
                            this._showTracksInCustomElement(trackElement, trackElement.language);
                        }
                    }
                }, this);
            },

            /**
             * When user select other language or different text track
             * @param {Object} selectedTrack
             * @private
             */
            _setSelectedTag: function(selectedTrack) {
                let _status, _track;
                Objs.iter(this._video.textTracks, function(track, index) {
                    _track = this._video.textTracks[index];
                    if (typeof _track === 'object' && _track) {
                        _status = _track.language === selectedTrack.lang ? (this._dyn.get("tracktagsstyled") ? 'hidden' : 'showing') : 'disabled';
                        if (!this._dyn.get("tracktextvisible")) _status = 'disabled';
                        _track.mode = _status;
                        if (_track.language === selectedTrack.lang) {
                            this._triggerTrackChange(this._video, _track, _status, selectedTrack.lang);
                        }
                    }
                }, this);
            },

            // Fixed issue when unable switch directly to showing from disabled
            _triggerTrackChange: function(video, track, status, lang) {
                const _trackElement = video.querySelector("#" + track.id);
                const onTrackEvent = this.auto_destroy(new DomEvents());
                if (track.oncuechange !== undefined) {
                    onTrackEvent.on(track, "cuechange", function() {
                        if (status.length) track.mode = status;
                        if (this._dyn.get("tracktagsstyled"))
                            this._showTracksInCustomElement(track, lang);
                        else if (_trackElement) {
                            _trackElement.mode = status;
                            // _trackElement.setAttribute('default', '');
                        }
                    }, this);
                }
            }
        };
    }]);
});