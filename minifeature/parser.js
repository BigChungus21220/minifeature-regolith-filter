const Ajv = require('ajv');
const fs = require("fs");
const path = require("path");
const jsonc = require("jsonc");
const yaml = require("yaml");

const filter_dir = process.env.FILTER_DIR === process.env.ROOT_DIR ? process.env.FILTER_DIR + "/.." : process.env.FILTER_DIR;
if (filter_dir === undefined){
  throw new Error("FILTER_DIR not defined");
}

/*
High-level Procedure:
- load schemas
- load, parse, validate, and register features & templates
- register vanilla features
- recursively split features into separate files and to correct format
- delete minifeatures folder
*/

// constants

const features_dir = "./BP/features";
const minifeatures_dir = "./BP/minifeatures";
const feature_rules_dir = "./BP/feature_rules";
const schema_dir = filter_dir + "/schemas";

const path_pattern = new RegExp("^([a-z_][a-z0-9_]*):([a-z_][a-z0-9_]*/)*([a-z_][a-z0-9_]*)$");
const simple_path_pattern = new RegExp("^([a-z_][a-z0-9_]*):([a-z_][a-z0-9_]*)/([a-z_][a-z0-9_]*)$");
const ref_pattern = new RegExp("^(([a-z_][a-z0-9_]*)\\.)?([a-z_][a-z0-9_]*)$");
const whitespace_pattern = new RegExp("(\\s+)|(\\\\n)", "g");
const var_pattern = /^\$[a-z_][a-z_0-9]*\$$/;
const inner_var_pattern = /\$[a-z_][a-z_0-9]*\$/g;
const template_name_pattern = /^<[a-z_][a-z0-9_]*>$/;
const template_ref_pattern = /^(([a-z_][a-z0-9_]*)\.)?(<[a-z_][a-z0-9_]*>)$/;

const entrypoint = "feature_file.schema.json";



let namespaces = {};
let templates = {};

// splits a feature path into its parts
function path_split(path) {
  const match = path.match(simple_path_pattern);
  const [, pack, namespace, name] = match;
  return [pack, namespace, name];
}

// converts a feature reference to a feature path
function ref_to_path(ref, namespace) {
  if (!path_pattern.test(ref)) {
    const match = ref.match(ref_pattern);
    if (match) {
      const [, , ref_namespace, ref_name] = match;
      if (!ref_namespace) {
        return [`minifeature:${namespace}/${ref_name}`, "local"];
      } else {
        return [`minifeature:${ref_namespace}/${ref_name}`, "namespaced"];
      }
    } else {
      console.error(`Invalid feature reference: ${ref}`);
    }
  }
  return [ref, "path"];
}

// writes a feature to its respective path
function write_path(base_dir, namespace, name, object, is_rule=false) {
  if (!fs.existsSync(base_dir)) {
    fs.mkdirSync(base_dir);
  }
  if (is_rule) {
    if (fs.existsSync(`${base_dir}/${name}.json`)){
      throw new Error(`File Conflict: "${base_dir}/${name}.json" already exists. Ensure all feature rules have unique names.`);
    }
    let fd = fs.openSync(`${base_dir}/${name}.json`, 'w');
    fs.writeFileSync(fd, JSON.stringify(object, (_, value) => {
      if (typeof value === "string") {
        return value.replaceAll(whitespace_pattern, " ");
      }
      return value;
    }, 4));
    fs.closeSync(fd);
  } else {
    const dir_path = `${base_dir}/${namespace}`;
    if (!fs.existsSync(dir_path)) {
      fs.mkdirSync(dir_path);
    }
    if (fs.existsSync(`${dir_path}/${name}.json`)){
      throw new Error(`File Conflict: "${dir_path}/${name}.json" already exists`);
    }
    let fd = fs.openSync(`${dir_path}/${name}.json`, 'w');
    fs.writeFileSync(fd, JSON.stringify(object, (_, value) => {
      if (typeof value === "string") {
        return value.replaceAll(whitespace_pattern, " ");
      }
      return value;
    }, 4));
    fs.closeSync(fd);
  }
}

// run a function on all file contents in a directory
function forEachFile(directory, fn, recursive=false){
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


// load schema files & locate schema entrypoint

const ajv = new Ajv({strict: false});

forEachFile(schema_dir, (data, filename) => {
  let json = JSON.parse(data);
  json["$id"] = filename;
  ajv.addSchema(json);
  /*if (filename === entrypoint) {
    schema = json;
  }*/
}, true);


// read feature files, validate, map

// list of top-level feature paths (normalized)
// full paths ie: pack:dir/file
let featureList = new Set();

let success = true;

if (!fs.existsSync(minifeatures_dir)){
  process.exit(0);
}


forEachFile(minifeatures_dir, (data, filename) => {
  const filetype = filename.split('.').pop();

  // parse feature

  let feature;
  if (filetype === "yaml"){
    try {
      feature = yaml.parse(data);
    } catch (err) {
      console.error(`Error parsing YAML from ${filename}:`, err);
      success = false;
      return;
    }
  } else if (filetype === "json" || filetype === "jsonc") {
    try {
      feature = jsonc.parse(data);
    } catch (err) {
      console.error(`Error parsing JSON from ${filename}:`, err);
      success = false;
      return;
    }
  } else {
    console.error(`Unexpected feature filetype in ${filename}: ${filetype}`);
    success = false;
    return;
  }

  // validate feature
  
  const errors = ajv.validate(entrypoint, feature).errors;
  if (errors) {
    console.error(`Schema validation failed on ${filename}. Error(s):`);
    errors.forEach((error) => {
      console.error(error.stack);
    });
    success = false;
    return;
  }

  // register feature
  
  let namespace = feature.namespace;
  delete feature.namespace;
  namespaces[namespace] = {};
  templates[namespace] = {};
  
  for (const key in feature) {
    if (template_name_pattern.test(key)){
      if (key in templates[namespace]){
        console.error(`Duplicate template, ${namespace}.${key}`);
      }
      templates[namespace][key] = feature[key];
    } else {
      const [path, ] = ref_to_path(key, namespace);
      if (featureList.has(path)) {
        console.error(`Duplicate feature, ${path}`);
        success = false;
      } else {
        featureList.add(path);
      }
      namespaces[namespace][path] = feature[key];
    }
  }
}, true);

// scan vanilla features & rules in this pack

function addFeature(data, file){
  let feature;

  try {
    feature = jsonc.parse(data);
  } catch (err) {
    console.error(`Error parsing JSON from ${file}:`, err);
    success = false;
    return;
  }

  // find the feature identifier
  let identifier;
  for (const key in feature) {
    if (key !== 'format_version') {
      const feature_def = feature[key];
      if (feature_def && typeof feature_def === 'object' && feature_def.description && typeof feature_def.description.identifier === 'string') {
        identifier = feature_def.description.identifier;
      } else {
        console.error(`Failed to locate feature identifier in ${file}`);
        success = false;
        return;
      }
    }
  }

  // add the feature to the feature list
  if (identifier){
    if (featureList.has(identifier)){
      console.error(`Duplicate feature, ${identifier}`);
      success = false;
      return;
    } else {
      featureList.add(identifier);
    }
  }
}

if (fs.existsSync(features_dir)){
  forEachFile(features_dir, addFeature, true);
}
if (fs.existsSync(feature_rules_dir)){
  forEachFile(feature_rules_dir, addFeature, true);
}

if (!success){
  throw new Error("Error(s) encountered while reading features, exiting.");
}


// define features

function ref_normalize(ref, path, namespace, index=0) {
  if (typeof ref === "string") {
    // convert reference to path
    [ref, ref_type] = ref_to_path(ref, namespace);

    // check that referenced feature exists
    if (!featureList.has(ref)) {
      if (ref_type == "path"){
        console.warn(`Feature ${ref} not found locally. This feature may not exist.`);
      } else {
        console.error(`Feature ${ref} not found.`);
      }
    }

    return ref;
  } else {
    const child_path = `${path}_${index}`;
    if (featureList.has(child_path)) {
      console.error(`Duplicate feature, ${child_path}`);
    } else {
      featureList.add(child_path);
      getFeatureType(ref).flatten(ref, child_path);
    }
    return child_path;
  }
}

// returns the feature type of a feature from the registry
function getFeatureType(feature){
  const featureType = featureRegistry[feature.type];
  if (featureType){
    return featureType;
  }
  throw new Error(`Feature type "${feature.type}" does not exist.`);
}


const featureRegistry = {
  rule: {
    // flattens the feature tree into a list of features
    flatten: (feature, path) => {
      const [, namespace, name] = path_split(path);
      feature.places = ref_normalize(feature.places, path, namespace);
      feature.description = {
        identifier: `minifeature:${name}`,
        places_feature: feature.places
      };
      delete feature.type;
      delete feature.places;

      write_path(feature_rules_dir, namespace, name, {
        format_version: "1.13.0",
        "minecraft:feature_rules": feature
      }, true);
    },

    forPlaces: (feature, func) => {
      func(feature.places);
    }
  },

  aggregate: {
    // flattens the feature tree into a list of features
    flatten: (feature, path) => {
      const [, namespace, name] = path_split(path);
      feature.features = [];
      let i = 0;
      feature.places.forEach((ref) => {
        feature.features.push(ref_normalize(ref, path, namespace, i));
        i++;
      });
      feature.description = {
        identifier: path
      };
      delete feature.type;
      delete feature.places;

      write_path(features_dir, namespace, name, {
        format_version: "1.13.0",
        "minecraft:aggregate_feature": feature
      });
    },

    forPlaces: (feature, func) => {
      for (let ref of feature.places){
        func(ref);
      }
    }
  },

  block: {
    // flattens the feature tree into a list of features
    flatten: (feature, path) => {
      const [, namespace, name] = path_split(path);
      feature.description = {
        identifier: path
      };
      delete feature.type;

      write_path(features_dir, namespace, name, {
        format_version: "1.13.0",
        "minecraft:single_block_feature": feature
      });
    },

    forPlaces: (feature, func) => {}
  },

  conditional_list: {
    // flattens the feature tree into a list of features
    flatten: (feature, path) => {
      const [, namespace, name] = path_split(path);
      feature.features = [];
      let i = 0;
      feature.places.forEach(([ref, condition]) => {
        const wrapper = {
          type: "scatter",
          places: ref,
          distribution: {
            iterations: condition,
            x: 0,
            y: 0,
            z: 0
          }
        }
        feature.features.push(ref_normalize(wrapper, path, namespace, i));
        i++;
      });
      feature.description = {
        identifier: path
      };
      delete feature.type;
      delete feature.places;

      write_path(features_dir, namespace, name, {
        format_version: "1.13.0",
        "minecraft:aggregate_feature": feature
      });
    },

    forPlaces: (feature, func) => {
      for (let [ref, _] of feature.places){
        func(ref);
      }
    }
  },

  geode: {
    // flattens the feature tree into a list of features
    flatten: (feature, path) => {
      const [, namespace, name] = path_split(path);
      feature.description = {
        identifier: path
      };
      delete feature.type;

      write_path(features_dir, namespace, name, {
        format_version: "1.13.0",
        "minecraft:geode_feature": feature
      });
    },

    forPlaces: (feature, func) => {}
  },

  growing_plant: {
    // flattens the feature tree into a list of features
    flatten: (feature, path) => {
      const [, namespace, name] = path_split(path);
      feature.description = {
        identifier: path
      };
      delete feature.type;

      write_path(features_dir, namespace, name, {
        format_version: "1.13.0",
        "minecraft:growing_plant_feature": feature
      });
    },

    forPlaces: (feature, func) => {}
  },

  ore: {
    // flattens the feature tree into a list of features
    flatten: (feature, path) => {
      const [, namespace, name] = path_split(path);
      feature.description = {
        identifier: path
      };
      delete feature.type;

      write_path(features_dir, namespace, name, {
        format_version: "1.13.0",
        "minecraft:ore_feature": feature
      });
    },

    forPlaces: (feature, func) => {}
  },

  scatter: {
    // flattens the feature tree into a list of features
    flatten: (feature, path) => {
      const [, namespace, name] = path_split(path);
      feature.places_feature = ref_normalize(feature.places, path, namespace);
      feature.description = {
        identifier: path
      };
      feature = structuredClone({...feature, ...feature.distribution});
      delete feature.distribution;
      delete feature.type;
      delete feature.places;

      write_path(features_dir, namespace, name, {
        format_version: "1.13.0",
        "minecraft:scatter_feature": feature
      });
    },

    forPlaces: (feature, func) => {
      func(feature.places);
    }
  },

  search: {
    // flattens the feature tree into a list of features
    flatten: (feature, path) => {
      const [, namespace, name] = path_split(path);
      feature.places_feature = ref_normalize(feature.places, path, namespace);
      feature.description = {
        identifier: path
      };
      delete feature.type;
      delete feature.places;

      write_path(features_dir, namespace, name, {
        format_version: "1.13.0",
        "minecraft:search_feature": feature
      });
    },

    forPlaces: (feature, func) => {
      func(feature.places);
    }
  },

  structure: {
    // flattens the feature tree into a list of features
    flatten: (feature, path) => {
      const [, namespace, name] = path_split(path);
      feature.structure_name = feature.places_structure;
      feature.description = {
        identifier: path
      };
      delete feature.places_structure;
      delete feature.type;

      write_path(features_dir, namespace, name, {
        format_version: "1.13.0",
        "minecraft:structure_template_feature": feature
      });
    },

    forPlaces: (feature, func) => {}
  },

  surface_snap: {
    // flattens the feature tree into a list of features
    flatten: (feature, path) => {
      const [, namespace, name] = path_split(path);
      feature.feature_to_snap = ref_normalize(feature.places, path, namespace);
      feature.description = {
        identifier: path
      };
      delete feature.type;
      delete feature.places;

      write_path(features_dir, namespace, name, {
        format_version: "1.13.0",
        "minecraft:snap_to_surface_feature": feature
      });
    },

    forPlaces: (feature, func) => {
      func(feature.places);
    }
  },

  vegetation_patch: {
    // flattens the feature tree into a list of features
    flatten: (feature, path) => {
      const [, namespace, name] = path_split(path);
      feature.vegetation_feature = ref_normalize(feature.places, path, namespace);
      feature.description = {
        identifier: path
      };
      delete feature.type;
      delete feature.places;

      write_path(features_dir, namespace, name, {
        format_version: "1.13.0",
        "minecraft:vegetation_patch_feature": feature
      });
    },

    forPlaces: (feature, func) => {
      func(feature.places);
    }
  },

  weighted_random: {
    // flattens the feature tree into a list of features
    flatten: (feature, path) => {
      const [, namespace, name] = path_split(path);
      feature.features = [];
      let i = 0;
      feature.places.forEach(([ref, weight]) => {
        feature.features.push([ref_normalize(ref, path, namespace, i), weight]);
        i++;
      });
      feature.description = {
        identifier: path
      };
      delete feature.type;
      delete feature.places;

      write_path(features_dir, namespace, name, {
        format_version: "1.13.0",
        "minecraft:weighted_random_feature": feature
      });
    },

    forPlaces: (feature, func) => {
      for (let [ref, _] of feature.places){
        func(ref);
      }
    }
  }
};


// resolve templates & variables

// resolves variables (recursively)
function resolveVars(value, vars) {
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
        console.warn(`Unresolved variable "${value}"`);
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

// resolves templates and variables
function resolve(feature, feature_namespace, vars){
  // update variable list
  for (prop in feature){
    if (var_pattern.test(prop)){
      if (!(prop in vars)) {
        vars[prop] = feature[prop];
      }
      delete feature[prop];
    }
  }
  feature = resolveVars(feature, vars);
  
  // resolve templates
  if ("type" in feature){
    getFeatureType(feature).forPlaces(feature, (subfeature) => {
      if (typeof subfeature == "object"){
        const res = resolve(subfeature, feature_namespace, structuredClone(vars));
        Object.keys(subfeature).forEach(k => delete subfeature[k]);
        Object.assign(subfeature, res);
      }
    });

  } else {
    const match = feature.inherits.match(template_ref_pattern);

    if (match){
      let namespace = match[2];
      if (!namespace){
        namespace = feature_namespace;
      }
      let name = match[3];
      feature = resolve(templates[namespace][name], feature_namespace, structuredClone(vars));
    } else {
      console.error("feature.inherits does not meet expected pattern. (This state should be unreachable)");
    }
  }
  return feature;
}

for (const namespace in namespaces){
  for (const key in namespaces[namespace]){
    namespaces[namespace][key] = resolve(namespaces[namespace][key], namespace, []);
  }
}

// re-validate schemas without vars or templates

// toggle templates & vars
function disableSchema(id){
  ajv.removeSchema(id);
  ajv.addSchema({ "$id": id, "not": {} });
}

disableSchema("template_ref.schema.json");
disableSchema("variable.schema.json");
disableSchema("variable_assignment.schema.json");
disableSchema("cond_ignore.schema.json");

// re-validate
for (const namespace in namespaces) {
  for (const key in namespaces[namespace]) {
    const feature = namespaces[namespace][key];
    const errors = ajv.validate(entrypoint, feature).errors;
    if (errors){
      console.error(`Schema validation failed on ${namespace}.${key} after template resolution. Error(s):`);
      errors.forEach((error) => {
        console.error(error.stack);
      });
      success = false;
      return;
    }
  }
}

if (!success){
  throw new Error("Error(s) encountered while expanding features, exiting.");
}

// split features into files & convert to correct format

for (const namespace in namespaces) {
  for (const key in namespaces[namespace]) {
    const feature = namespaces[namespace][key];
    getFeatureType(feature).flatten(feature, key);
  }
}


// remove minifeatures directory

fs.rmSync(minifeatures_dir, {recursive: true});