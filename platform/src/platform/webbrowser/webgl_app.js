import {WasmApp} from "/makepad/platform/wasm_bridge/src/wasm_app.js"
import {pack_key_modifier} from "./webgl_util.js"

export class WebGLWasmApp extends WasmApp {
    constructor(wasm, canvas) {
        super (wasm);
        
        this.canvas = canvas;
        
        this.init_detection();
        this.init_webgl_context();
        this.bind_mouse_and_touch();
        this.bind_keyboard();
        
        this.to_wasm = this.new_to_wasm();
        
        // alright lets send the fucker an init
        this.to_wasm.ToWasmConstructAndGetDeps({
            gpu_info: this.gpu_info,
            browser_info: {
                protocol: location.protocol + "",
                hostname: location.hostname + "",
                pathname: location.pathname + "",
                search: location.search + "",
                hash: location.hash + "",
            }
        });
        
        this.do_wasm_io();
    }
    
    FromWasmSetMouseCursor(args){
        document.body.style.cursor = this.cursor_map[args.web_cursor] || 'default'
    }
    
    do_wasm_io() {
        let to_wasm = this.to_wasm;
        this.to_wasm = this.new_to_wasm();
        this.to_wasm_pump(this.to_wasm);
    }
    
    FromWasmLoadDeps(deps) {
        console.log(deps);
    }
    
    on_screen_resize() {
        var dpi_factor = window.devicePixelRatio;
        var w,
        h;
        var canvas = this.canvas;
        
        if (this.xr_is_presenting) {
            let xr_webgllayer = this.xr_session.renderState.baseLayer;
            this.dpi_factor = 3.0;
            this.width = 2560.0 / this.dpi_factor;
            this.height = 2000.0 / this.dpi_factor;
        }
        else {
            if (canvas.getAttribute("fullpage")) {
                if (this.detect.is_add_to_homescreen_safari) { // extremely ugly. but whatever.
                    if (window.orientation == 90 || window.orientation == -90) {
                        h = screen.width;
                        w = screen.height - 90;
                    }
                    else {
                        w = screen.width;
                        h = screen.height - 80;
                    }
                }
                else {
                    w = window.innerWidth;
                    h = window.innerHeight;
                }
            }
            else {
                w = canvas.offsetWidth;
                h = canvas.offsetHeight;
            }
            var sw = canvas.width = w * dpi_factor;
            var sh = canvas.height = h * dpi_factor;
            
            this.gl.viewport(0, 0, sw, sh);
            
            this.dpi_factor = dpi_factor;
            this.width = canvas.offsetWidth;
            this.height = canvas.offsetHeight;
            // send the wasm a screenresize event
        }
        
        if (this.to_wasm) {
            // initialize the application
            this.to_wasm.resize({
                width: this.width,
                height: this.height,
                dpi_factor: this.dpi_factor,
                xr_is_presenting: this.xr_is_presenting,
                xr_can_present: this.xr_can_present,
                is_fullscreen: this.is_fullscreen(),
                can_fullscreen: this.can_fullscreen()
            })
            this.request_animation_frame()
        }
    }
    
    request_animation_frame() {
        if (this.xr_is_presenting || this.req_anim_frame_id) {
            return;
        }
        this.req_anim_frame_id = window.requestAnimationFrame(time => {
            this.req_anim_frame_id = 0;
            if (this.xr_is_presenting) {
                return
            }
            this.to_wasm.animation_frame(time / 1000.0);
            this.in_animation_frame = true;
            this.do_wasm_io();
            this.in_animation_frame = false;
        })
    }
    
    init_detection() {
        this.detect = {
            user_agent: window.navigator.userAgent,
            is_mobile_safari: window.navigator.platform.match(/iPhone|iPad/i),
            is_touch_device: ('ontouchstart' in window || navigator.maxTouchPoints),
            is_firefox: navigator.userAgent.toLowerCase().indexOf('firefox') > -1,
        }
        this.detect.is_android = this.detect.user_agent.match(/Android/i)
        this.detect.is_add_to_homescreen_safari = this.is_mobile_safari && navigator.standalone
    }
    
    init_webgl_context() {
        
        window.addEventListener('resize', _ => {
            this.on_screen_resize()
        })
        
        window.addEventListener('orientationchange', _ => {
            this.on_screen_resize()
        })
        
        let mqString = '(resolution: ' + window.devicePixelRatio + 'dppx)'
        let mq = matchMedia(mqString);
        if (mq && mq.addEventListener) {
            mq.addEventListener("change", _ => {
                this.on_screen_resize()
            });
        }
        else { // poll for it. yes. its terrible
            window.setInterval(_ => {
                if (window.devicePixelRation != this.dpi_factor) {
                    this.on_screen_resize()
                }
            }, 1000);
        }
        
        var canvas = this.canvas
        var options = {
            alpha: canvas.getAttribute("noalpha")? false: true,
            depth: canvas.getAttribute("nodepth")? false: true,
            stencil: canvas.getAttribute("nostencil")? false: true,
            antialias: canvas.getAttribute("noantialias")? false: true,
            premultipliedAlpha: canvas.getAttribute("premultipliedAlpha")? true: false,
            preserveDrawingBuffer: canvas.getAttribute("preserveDrawingBuffer")? true: false,
            preferLowPowerToHighPerformance: true,
            //xrCompatible: true
        }
        
        var gl = this.gl = canvas.getContext('webgl', options)
            || canvas.getContext('webgl-experimental', options)
            || canvas.getContext('experimental-webgl', options)
        
        if (!gl) {
            var span = document.createElement('span')
            span.style.color = 'white'
            canvas.parentNode.replaceChild(span, canvas)
            span.innerHTML = "Sorry, makepad needs browser support for WebGL to run<br/>Please update your browser to a more modern one<br/>Update to atleast iOS 10, Safari 10, latest Chrome, Edge or Firefox<br/>Go and update and come back, your browser will be better, faster and more secure!<br/>If you are using chrome on OSX on a 2011/2012 mac please enable your GPU at: Override software rendering list:Enable (the top item) in: <a href='about://flags'>about://flags</a>. Or switch to Firefox or Safari."
            return
        }
        this.OES_standard_derivatives = gl.getExtension('OES_standard_derivatives')
        this.OES_vertex_array_object = gl.getExtension('OES_vertex_array_object')
        this.OES_element_index_uint = gl.getExtension("OES_element_index_uint")
        this.ANGLE_instanced_arrays = gl.getExtension('ANGLE_instanced_arrays')
        
        // check uniform count
        var max_vertex_uniforms = gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS);
        var max_fragment_uniforms = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS);
        this.gpu_info = {
            min_uniforms: Math.min(max_vertex_uniforms, max_fragment_uniforms),
            vendor: "unknown",
            renderer: "unknown"
        }
        let debug_info = gl.getExtension('WEBGL_debug_renderer_info');
        
        if (debug_info) {
            this.gpu_info.vendor = gl.getParameter(debug_info.UNMASKED_VENDOR_WEBGL);
            this.gpu_info.renderer = gl.getParameter(debug_info.UNMASKED_RENDERER_WEBGL);
        }
        
        //gl.EXT_blend_minmax = gl.getExtension('EXT_blend_minmax')
        //gl.OES_texture_half_float_linear = gl.getExtension('OES_texture_half_float_linear')
        //gl.OES_texture_float_linear = gl.getExtension('OES_texture_float_linear')
        //gl.OES_texture_half_float = gl.getExtension('OES_texture_half_float')
        //gl.OES_texture_float = gl.getExtension('OES_texture_float')
        //gl.WEBGL_depth_texture = gl.getExtension("WEBGL_depth_texture") || gl.getExtension("WEBKIT_WEBGL_depth_texture")
        this.on_screen_resize()
    }
    
    bind_mouse_and_touch() {
        
        this.cursor_map = [
            "none", //Hidden=>0
            "default", //Default=>1,
            "crosshair", //CrossHair=>2,
            "pointer", //Hand=>3,
            "default", //Arrow=>4,
            "move", //Move=>5,
            "text", //Text=>6,
            "wait", //Wait=>7,
            "help", //Help=>8,
            "not-allowed", //NotAllowed=>9,
            "n-resize", // NResize=>10,
            "ne-resize", // NeResize=>11,
            "e-resize", // EResize=>12,
            "se-resize", // SeResize=>13,
            "s-resize", // SResize=>14,
            "sw-resize", // SwResize=>15,
            "w-resize", // WResize=>16,
            "nw-resize", // NwResize=>17,
            "ns-resize", //NsResize=>18,
            "nesw-resize", //NeswResize=>19,
            "ew-resize", //EwResize=>20,
            "nwse-resize", //NwseResize=>21,
            "col-resize", //ColResize=>22,
            "row-resize", //RowResize=>23,
        ]
        
        var canvas = this.canvas
        
        let use_touch_scroll_overlay = window.ontouchstart === null;
        let last_mouse_finger;
        if (use_touch_scroll_overlay) {
            var ts = this.touch_scroll_overlay = document.createElement('div')
            ts.className = "cx_webgl_scroll_overlay"
            var ts_inner = document.createElement('div')
            var style = document.createElement('style')
            style.innerHTML = "\n"
                + "div.cx_webgl_scroll_overlay {\n"
                + "z-index: 10000;\n"
                + "margin:0;\n"
                + "overflow:scroll;\n"
                + "top:0;\n"
                + "left:0;\n"
                + "width:100%;\n"
                + "height:100%;\n"
                + "position:fixed;\n"
                + "background-color:transparent\n"
                + "}\n"
                + "div.cx_webgl_scroll_overlay div{\n"
                + "margin:0;\n"
                + "width:400000px;\n"
                + "height:400000px;\n"
                + "background-color:transparent\n"
                + "}\n"
            
            document.body.appendChild(style)
            ts.appendChild(ts_inner);
            document.body.appendChild(ts);
            canvas = ts;
            
            ts.scrollTop = 200000;
            ts.scrollLeft = 200000;
            let last_scroll_top = ts.scrollTop;
            let last_scroll_left = ts.scrollLeft;
            let scroll_timeout = null;
            ts.addEventListener('scroll', e => {
                let new_scroll_top = ts.scrollTop;
                let new_scroll_left = ts.scrollLeft;
                let dx = new_scroll_left - last_scroll_left;
                let dy = new_scroll_top - last_scroll_top;
                last_scroll_top = new_scroll_top;
                last_scroll_left = new_scroll_left;
                window.clearTimeout(scroll_timeout);
                scroll_timeout = window.setTimeout(_ => {
                    ts.scrollTop = 200000;
                    ts.scrollLeft = 200000;
                    last_scroll_top = ts.scrollTop;
                    last_scroll_left = ts.scrollLeft;
                }, 200);
                
                let finger = last_mouse_finger;
                if (finger) {
                    finger.scroll_x = dx;
                    finger.scroll_y = dy;
                    finger.is_wheel = true;
                    this.to_wasm.ToWasmFingerScroll({
                        
                    });
                    this.to_wasm.finger_scroll(finger);
                    this.do_wasm_io();
                }
            })
        }
        
        var mouse_fingers = [];
        function mouse_to_finger(e) {
            let mf = mouse_fingers[e.button] || (mouse_fingers[e.button] = {});
            mf.x = e.pageX;
            mf.y = e.pageY;
            mf.digit = e.button;
            mf.time = e.timeStamp / 1000.0;
            mf.modifiers = pack_key_modifier(e);
            mf.touch = false;
            return mf
        }
        
        var digit_map = {}
        var digit_alloc = 0;
        
        function touch_to_finger_alloc(e) {
            var f = []
            for (let i = 0; i < e.changedTouches.length; i ++) {
                var t = e.changedTouches[i]
                // find an unused digit
                var digit = undefined;
                for (digit in digit_map) {
                    if (!digit_map[digit]) break
                }
                // we need to alloc a new one
                if (digit === undefined || digit_map[digit]) digit = digit_alloc ++;
                // store it
                digit_map[digit] = {identifier: t.identifier};
                // return allocated digit
                digit = parseInt(digit);
                
                f.push({
                    x: t.pageX,
                    y: t.pageY,
                    digit: digit,
                    time: e.timeStamp / 1000.0,
                    modifiers: 0,
                    touch: true,
                })
            }
            return f
        }
        
        function lookup_digit(identifier) {
            for (let digit in digit_map) {
                var digit_id = digit_map[digit]
                if (!digit_id) continue
                if (digit_id.identifier == identifier) {
                    return digit
                }
            }
        }
        
        function touch_to_finger_lookup(e) {
            var f = []
            for (let i = 0; i < e.changedTouches.length; i ++) {
                var t = e.changedTouches[i]
                f.push({
                    x: t.pageX,
                    y: t.pageY,
                    digit: lookup_digit(t.identifier),
                    time: e.timeStamp / 1000.0,
                    modifiers: {},
                    touch: true,
                })
            }
            return f
        }
        
        function touch_to_finger_free(e) {
            var f = []
            for (let i = 0; i < e.changedTouches.length; i ++) {
                var t = e.changedTouches[i]
                var digit = lookup_digit(t.identifier)
                if (!digit) {
                    console.log("Undefined state in free_digit");
                    digit = 0
                }
                else {
                    digit_map[digit] = undefined
                }
                
                f.push({
                    x: t.pageX,
                    y: t.pageY,
                    time: e.timeStamp / 1000.0,
                    digit: digit,
                    modifiers: 0,
                    touch: true,
                })
            }
            return f
        }
        
        var easy_xr_presenting_toggle = window.localStorage.getItem("xr_presenting") == "true"
        
        var mouse_buttons_down = [];
        this.mouse_down_handler = e => {
            e.preventDefault();
            this.focus_keyboard_input();
            mouse_buttons_down[e.button] = true;
            this.to_wasm.finger_down(mouse_to_finger(e))
            this.do_wasm_io();
        }
        
        canvas.addEventListener('mousedown', this.mouse_down_handler)
        
        this.mouse_up_handler = e => {
            e.preventDefault();
            mouse_buttons_down[e.button] = false;
            this.to_wasm.finger_up(mouse_to_finger(e))
            this.do_wasm_io();
        }
        
        window.addEventListener('mouseup', this.mouse_up_handler)
        
        let mouse_move = e => {
            document.body.scrollTop = 0;
            document.body.scrollLeft = 0;
            
            for (var i = 0; i < mouse_buttons_down.length; i ++) {
                if (mouse_buttons_down[i]) {
                    let mf = mouse_to_finger(e);
                    mf.digit = i;
                    this.to_wasm.finger_move(mf);
                }
            }
            last_mouse_finger = mouse_to_finger(e);
            this.to_wasm.finger_hover(last_mouse_finger);
            this.do_wasm_io();
            //console.log("Redraw cycle "+(end-begin)+" ms");
        }
        window.addEventListener('mousemove', mouse_move);
        
        window.addEventListener('mouseout', e => {
            this.to_wasm.finger_out(mouse_to_finger(e)) //e.pageX, e.pageY, pa;
            this.do_wasm_io();
        });
        canvas.addEventListener('contextmenu', e => {
            e.preventDefault()
            return false
        })
        canvas.addEventListener('touchstart', e => {
            e.preventDefault()
            
            let fingers = touch_to_finger_alloc(e);
            for (let i = 0; i < fingers.length; i ++) {
                this.to_wasm.finger_down(fingers[i])
            }
            this.do_wasm_io();
            return false
        })
        canvas.addEventListener('touchmove', e => {
            //e.preventDefault();
            var fingers = touch_to_finger_lookup(e);
            for (let i = 0; i < fingers.length; i ++) {
                this.to_wasm.finger_move(fingers[i])
            }
            this.do_wasm_io();
            return false
        }, {passive: false})
        
        var end_cancel_leave = e => {
            //if (easy_xr_presenting_toggle) {
            //    easy_xr_presenting_toggle = false;
            //    this.xr_start_presenting();
            //};
            
            e.preventDefault();
            var fingers = touch_to_finger_free(e);
            for (let i = 0; i < fingers.length; i ++) {
                this.to_wasm.finger_up(fingers[i])
            }
            this.do_wasm_io();
            return false
        }
        
        canvas.addEventListener('touchend', end_cancel_leave);
        canvas.addEventListener('touchcancel', end_cancel_leave);
        canvas.addEventListener('touchleave', end_cancel_leave);
        
        var last_wheel_time;
        var last_was_wheel;
        this.mouse_wheel_handler = e => {
            var finger = mouse_to_finger(e)
            e.preventDefault()
            let delta = e.timeStamp - last_wheel_time;
            last_wheel_time = e.timeStamp;
            // typical web bullshit. this reliably detects mousewheel or touchpad on mac in safari
            if (is_firefox) {
                last_was_wheel = e.deltaMode == 1
            }
            else { // detect it
                if (Math.abs(Math.abs((e.deltaY / e.wheelDeltaY)) - (1. / 3.)) < 0.00001 || !last_was_wheel && delta < 250) {
                    last_was_wheel = false;
                }
                else {
                    last_was_wheel = true;
                }
            }
            //console.log(e.deltaY / e.wheelDeltaY);
            //last_delta = delta;
            var fac = 1
            if (e.deltaMode === 1) fac = 40
            else if (e.deltaMode === 2) fac = window.offsetHeight
            finger.scroll_x = e.deltaX * fac
            finger.scroll_y = e.deltaY * fac
            finger.is_wheel = last_was_wheel;
            this.to_wasm.finger_scroll(finger);
            this.do_wasm_io();
        };
        canvas.addEventListener('wheel', this.mouse_wheel_handler)
        
        //window.addEventListener('webkitmouseforcewillbegin', this.onCheckMacForce.bind(this), false)
        //window.addEventListener('webkitmouseforcechanged', this.onCheckMacForce.bind(this), false)
    }
    
    bind_keyboard() {
        if (this.detect.is_mobile_safari || this.detect.is_android) { // mobile keyboards are unusable on a UI like this. Not happening.
            return
        }
        var ta = this.text_area = document.createElement('textarea')
        ta.className = "cx_webgl_textinput"
        ta.setAttribute('autocomplete', 'off')
        ta.setAttribute('autocorrect', 'off')
        ta.setAttribute('autocapitalize', 'off')
        ta.setAttribute('spellcheck', 'false')
        var style = document.createElement('style')
        style.innerHTML = "\n"
            + "textarea.cx_webgl_textinput {\n"
            + "z-index: 1000;\n"
            + "position: absolute;\n"
            + "opacity: 0;\n"
            + "border-radius: 4px;\n"
            + "color:white;\n"
            + "font-size: 6;\n"
            + "background: gray;\n"
            + "-moz-appearance: none;\n"
            + "appearance:none;\n"
            + "border:none;\n"
            + "resize: none;\n"
            + "outline: none;\n"
            + "overflow: hidden;\n"
            + "text-indent: 0px;\n"
            + "padding: 0 0px;\n"
            + "margin: 0 -1px;\n"
            + "text-indent: 0px;\n"
            + "-ms-user-select: text;\n"
            + "-moz-user-select: text;\n"
            + "-webkit-user-select: text;\n"
            + "user-select: text;\n"
            + "white-space: pre!important;\n"
            + "}\n"
            + "textarea: focus.cx_webgl_textinput {\n"
            + "outline: 0px !important;\n"
            + "-webkit-appearance: none;\n"
            + "}"
        document.body.appendChild(style)
        ta.style.left = -100 + 'px'
        ta.style.top = -100 + 'px'
        ta.style.height = 1
        ta.style.width = 1
        
        //document.addEventListener('focusout', this.onFocusOut.bind(this))
        var was_paste = false;
        this.neutralize_ime = false;
        var last_len = 0;
        ta.addEventListener('cut', e => {
            setTimeout(_ => {
                ta.value = "";
                last_len = 0;
            }, 0)
        })
        ta.addEventListener('copy', e => {
            setTimeout(_ => {
                ta.value = "";
                last_len = 0;
            }, 0)
        })
        ta.addEventListener('paste', e => {
            was_paste = true;
        })
        ta.addEventListener('select', e => {
            
        })
        
        ta.addEventListener('input', e => {
            if (ta.value.length > 0) {
                if (was_paste) {
                    was_paste = false;
                    
                    this.to_wasm.text_input({
                        was_paste: true,
                        input: ta.value.substring(last_len),
                        replace_last: false,
                    })
                    ta.value = "";
                }
                else {
                    var replace_last = false;
                    var text_value = ta.value;
                    if (ta.value.length >= 2) { // we want the second char
                        text_value = ta.value.substring(1, 2);
                        ta.value = text_value;
                    }
                    else if (ta.value.length == 1 && last_len == ta.value.length) { // its an IME replace
                        replace_last = true;
                    }
                    // we should send a replace last
                    if (replace_last || text_value != '\n') {
                        this.to_wasm.text_input({
                            was_paste: false,
                            input: text_value,
                            replace_last: replace_last,
                        })
                    }
                }
                this.do_wasm_io();
            }
            last_len = ta.value.length;
        })
        
        ta.addEventListener('mousedown', this.mouse_down_handler);
        ta.addEventListener('mouseup', this.mouse_up_handler);
        ta.addEventListener('wheel', this.mouse_wheel_handler);
        ta.addEventListener('contextmenu', e => {
            e.preventDefault()
        });
        //ta.addEventListener('touchmove', e => {
        //})
        
        ta.addEventListener('blur', e => {
            this.focus_keyboard_input();
        })
        
        var ugly_ime_hack = false;
        
        ta.addEventListener('keydown', e => {
            let code = e.keyCode;
            
            //if (code == 91) {firefox_logo_key = true; e.preventDefault();}
            if (code == 18 || code == 17 || code == 16) e.preventDefault(); // alt
            if (code === 8 || code === 9) e.preventDefault() // backspace/tab
            if ((code === 88 || code == 67) && (e.metaKey || e.ctrlKey)) { // copy or cut
                // we need to request the clipboard
                this.to_wasm.text_copy();
                this.do_wasm_io();
                ta.value = this.text_copy_response;
                ta.selectionStart = 0;
                ta.selectionEnd = ta.value.length;
            }
            //    this.keyboardCut = true // x cut
            //if(code === 65 && (e.metaKey || e.ctrlKey)) this.keyboardSelectAll = true     // all (select all)
            if (code === 89 && (e.metaKey || e.ctrlKey)) e.preventDefault() // all (select all)
            if (code === 83 && (e.metaKey || e.ctrlKey)) e.preventDefault() // ctrl s
            if (code === 90 && (e.metaKey || e.ctrlKey)) {
                this.update_text_area_pos();
                ta.value = "";
                ugly_ime_hack = true;
                ta.readOnly = true;
                e.preventDefault()
            }
            // if we are using arrow keys, home or end
            let key_code = e.keyCode;
            
            if (key_code >= 33 && key_code <= 40) {
                ta.value = "";
                last_len = ta.value.length;
            }
            //if(key_code
            this.to_wasm.key_down({
                key_code: key_code,
                char_code: e.charCode,
                is_repeat: e.repeat,
                time: e.timeStamp / 1000.0,
                modifiers: pack_key_modifier(e)
            })
            
            this.do_wasm_io();
        })
        ta.addEventListener('keyup', e => {
            let code = e.keyCode;
            
            if (code == 18 || code == 17 || code == 16) e.preventDefault(); // alt
            if (code == 91) {e.preventDefault();}
            var ta = this.text_area;
            if (ugly_ime_hack) {
                ugly_ime_hack = false;
                document.body.removeChild(ta);
                this.bind_keyboard();
                this.update_text_area_pos();
            }
            this.to_wasm.key_up({
                key_code: e.keyCode,
                char_code: e.charCode,
                is_repeat: e.repeat,
                time: e.timeStamp / 1000.0,
                modifiers: pack_key_modifier(e)
            })
            this.do_wasm_io();
        })
        document.body.appendChild(ta);
        ta.focus();
    }
}