use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};
use crate::makepad_shell::*;

pub fn extract_dependency_paths(line: &str) -> Option<(String, Option<PathBuf>)> {
    let dependency_output_start = line.find(|c: char| c.is_alphanumeric())?;
    let dependency_output = &line[dependency_output_start..];

    let mut tokens = dependency_output.split(' ');
    if let Some(name) = tokens.next() {
        for token in tokens.collect::<Vec<&str>>() {
            if token == "(*)" || token == "(proc-macro)" {
                continue;
            }
            if token.starts_with('(') {
                let path = token[1..token.len() - 1].to_owned();
                let path = Path::new(&path);
                if path.is_dir(){
                    return Some((name.to_string(), Some(path.into())))
                }
            }
        }
        return Some((name.to_string(), None))
    }
    None
}

pub fn get_crate_dir(build_crate: &str) -> Result<PathBuf, String> {
    let cwd = std::env::current_dir().unwrap();
    if let Ok(output) = shell_env_cap(&[], &cwd, "cargo", &["pkgid", "-p", build_crate]) {
        #[cfg(target_os="windows")]
        {
            let output = output.strip_prefix("file:///").unwrap_or(&output);
            let output = output.strip_prefix("path+file:///").unwrap_or(output);
            return Ok(output.split('#').next().unwrap().into());
        }
        #[cfg(not(target_os="windows"))]
        {  
            let output = output.strip_prefix("file://").unwrap_or(&output);
            let output = output.strip_prefix("path+file://").unwrap_or(output);
            return Ok(output.split('#').next().unwrap().into());
        }
    } else {
        Err(format!("Failed to get crate dir for: {}", build_crate))
    }
}

pub fn get_crate_dep_dirs(build_crate: &str, build_dir:&Path, target:&str) -> HashMap<String, PathBuf> {
    let mut dependencies = HashMap::new();
    let cwd = std::env::current_dir().unwrap();
    let target = format!("--target={target}");
    if let Ok(cargo_tree_output) = shell_env_cap(&[], &cwd, "cargo", &["tree", "-p", build_crate, &target]) {
        for line in cargo_tree_output.lines().skip(1) {
            if let Some((name, path)) = extract_dependency_paths(line) {
                if let Some(path) = path{
                    dependencies.insert(name, path);
                }
                else { // check in the build dir for .path files, used to find the crate dir of a crates.io crate
                    let dir_file = build_dir.join(format!("{}.path", name));
                    if let Ok(path) = std::fs::read_to_string(&dir_file){
                        dependencies.insert(name, Path::new(&path).into());
                    }
                }
            }
        }
    }
    dependencies
}

pub fn get_build_crate_from_args(args: &[String]) -> Result<&str, String> {
    if args.is_empty() {
        return Err("Not enough arguments to build".into());
    }
    if args[0] == "-p" {
        if args.len()<2 { 
            return Err("Not enough arguments to build".into());
        }
        Ok(&args[1])
    }
    else {
        Ok(&args[0])
    }
}

pub fn get_profile_from_args(args: &[String]) -> String {
    for arg in args{
        if let Some(opt) = arg.strip_prefix("--profile=") {
            return opt.to_string();
        }
        if arg == "--release"{
            return "release".to_string()
        }
    }
    return "debug".to_string()
}

