import fs from "fs";
import path from "path";
import Ajv from "ajv";
import jsonc from "jsonc";

////////////
// patterns
////////////

export const path_pattern = new RegExp("^([a-z_][a-z0-9_]*):([a-z_][a-z0-9_]*/)*([a-z_][a-z0-9_]*)$");
export const simple_path_pattern = new RegExp("^([a-z_][a-z0-9_]*):([a-z_][a-z0-9_]*)/([a-z_][a-z0-9_]*)$");
export const ref_pattern = new RegExp("^(([a-z_][a-z0-9_]*)\\.)?([a-z_][a-z0-9_]*)$");
export const whitespace_pattern = new RegExp("(\\s+)|(\\\\n)", "g");
export const var_pattern = /^\$[a-z_][a-z_0-9]*\$$/;
export const inner_var_pattern = /\$[a-z_][a-z_0-9]*\$/g;
export const template_name_pattern = /^<[a-z_][a-z0-9_]*>$/;
export const template_ref_pattern = /^(([a-z_][a-z0-9_]*)\.)?(<[a-z_][a-z0-9_]*>)$/;


/////////////
// constants
/////////////

export const filter_dir = process.env.FILTER_DIR === process.env.ROOT_DIR ? process.env.FILTER_DIR + "/.." : process.env.FILTER_DIR;
if (filter_dir === undefined){
  throw new Error("FILTER_DIR not defined");
}

// load & validate settings
export const settings = (() => {
  const ajv = new Ajv({strict: false});

  let settings = {
    features_directory: "./BP/features",
    feature_rules_directory: "./BP/feature_rules",
    minifeatures_directory: "./BP/minifeatures",
    project_namespace: "minifeature",
    namespaced_subfolders: true
  };
  if (process.argv[2]){
    settings = {...settings, ...jsonc.parse(process.argv[2])};
  }

  const settings_schema = {
    type: "object",
    properties: {
      features_directory: { type: "string" },
      feature_rules_directory: { type: "string" },
      minifeatures_directory: { type: "string" },
      project_namespace: { type: "string" },
      namespaced_subfolders: { type: "boolean" }
    },
    required: ["project_namespace", "namespaced_subfolders"]
  };

  const validate_settings = ajv.compile(settings_schema);

  if (!validate_settings(settings)) {
    throw new Error("Invalid filter settings: ", validate_settings.errors);
  }

  return settings;
})();

export const schema_dir = filter_dir + "/schemas";


/////////////
// functions
/////////////

// run a function on all file contents in a directory
export function forEachFile(directory, fn, recursive=false){
  let files = fs.readdirSync(directory);
  
  files.forEach((file) => {
    const filePath = path.join(directory, file);
    const stat = fs.statSync(filePath);
    if (recursive && stat.isDirectory()) {
      forEachFile(filePath, fn, max_depth, depth + 1);
    } else if (stat.isFile()) {
      const data = fs.readFileSync(filePath, "utf8");
      fn(data, file);
    }
  });
}

// resolves variables recursively
export function resolveVars(value, vars) {
  if (typeof value === 'string') {
    if (var_pattern.test(value)) {
      if (value in vars) {
        return vars[value];
      } else {
        console.warn(`Unresolved variable "${value}"`);
        return value;
      }
    }

    return value.replace(inner_var_pattern, (match) => {
      if (match in vars) {
        return vars[match];
      } else {
        console.warn(`Unresolved inner variable "${value}"`);
        return value;
      }
    });
  } else if (Array.isArray(value)) {
    const resolved = [];
    for (const val of value){
      resolved.push(resolveVars(val, vars));
    }
    return resolved;
  } else if (value !== null && typeof value === 'object') {
    const resolved = {};
    for (const [key, val] of Object.entries(value)) {
      if (var_pattern.test(key)){
        resolved[key] = resolveVars(val, vars);
        if (!(key in vars)) {
          vars[key] = resolved[key];
        }
      } else {
        resolved[key] = resolveVars(val, structuredClone(vars));
      }
    }
    return resolved;
  } else {
    return value;
  }
}