use makepad_widgets::*;

live_design!{
    import makepad_widgets::frame::*;
    registry Widget::*;
    App= {{App}} {
        ui:{
            <ScrollY>{
                draw_bg:{color:#5, shape:Solid}
                <NumberGrid>{
                }
            }
        }
    }
}
app_main!(App);

#[derive(Live, LiveHook)]
#[live_design_with{
    crate::makepad_widgets::live_design(cx);
    crate::number_grid::live_design(cx);
}]
pub struct App {
    window: BareWindow,
    ui: FrameRef,
}

impl AppMain for App{
    fn handle_event(&mut self, cx: &mut Cx, event: &Event) {
        if let Event::Draw(event) = event {
            return self.draw(&mut Cx2d::new(cx, event));
        }

        self.window.handle_event(cx, event);
    }
}

impl App {  
    pub fn draw(&mut self, cx: &mut Cx2d) {
        if self.window.begin(cx).is_not_redrawing() {
            return;
        }
        
        while self.ui.draw(cx).is_not_done(){}
        
        self.ui.redraw(cx);
        
        self.window.end(cx);
    }
}