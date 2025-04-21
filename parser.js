let Validator = require("jsonschema").Validator;
const fs = require("fs");
const path = require("path");
let val = new Validator();

const single_comment = new RegExp("//.*[\n\r]", "g");
const multi_comment = new RegExp("/\\*.*\\*/", "g");
const newline = new RegExp("[\n\r]", "g");
const path_pattern = new RegExp("^([a-z_][a-z0-9_]*):([a-z_][a-z0-9_]*/)*([a-z_][a-z0-9_]*)$");
const simple_path_pattern = new RegExp("^([a-z_][a-z0-9_]*):([a-z_][a-z0-9_]*)/([a-z_][a-z0-9_]*)$");
const ref_pattern = new RegExp("^(([a-z_][a-z0-9_]*)\\.)?([a-z_][a-z0-9_]*)$");

const features_dir = "./features";
const feature_rules_dir = "./feature_rules";
const schemaDir = "./schemas";
const entrypoint = "feature_file.schema.json";
let namespaces = {};

function path_split(path) {
  const match = path.match(simple_path_pattern);
  const [, pack, namespace, name] = match;
  return [pack, namespace, name];
}

function ref_to_path(ref, namespace) {
  if (!path_pattern.test(ref)) {
    const match = ref.match(ref_pattern);
    if (match) {
      const [, , ref_namespace, ref_name] = match;
      if (ref_namespace === undefined) {
        return `minifeature:${namespace}/${ref_name}`;
      } else {
        return `minifeature:${ref_namespace}/${ref_name}`;
      }
    } else {
      console.error(`Invalid feature reference: ${ref}`);
    }
  }
  return ref;
}

function write_path(base_dir, namespace, name, object) {
  if (fs.existsSync(base_dir)) {
    const dir_path = `${base_dir}/${namespace}`;
    if (!fs.existsSync(dir_path)) {
      fs.mkdirSync(dir_path);
    }
    let fd = fs.openSync(`${dir_path}/${name}.json`, 'w');
    fs.writeFileSync(fd, JSON.stringify(object, null, 4));
    fs.closeSync(fd);
  } else {
    console.error(`Features directory not found. ${base_dir}`);
  }
}

function json_remove_ignored(jsonText){
  return jsonText.replaceAll(single_comment, "").replaceAll(newline, " ").replaceAll(multi_comment, "");
}


// load schema files & locate entrypoint

let schema = undefined;

try {
  const files = fs.readdirSync(schemaDir);

  files.forEach((file) => {
    const filePath = path.join(schemaDir, file);
    try {
      const data = fs.readFileSync(filePath, "utf8");
      let json = JSON.parse(data);
      json["$id"] = file;
      val.addSchema(json, file);
      if (file === entrypoint) {
        schema = json;
      }
    } catch (parseError) {
      console.error(`Error parsing JSON from ${filePath}:`, parseError.message);
      process.exitCode = 1;
    }
  });
} catch {
  console.error(`Could not read ${schemaDir}:`, err);
  process.exitCode = 1;
}

// read feature file & validate

const feature_file = "./example.minifeature.json";

let featureJSON = undefined;
try {
  const jsonText = fs.readFileSync(feature_file, {
    encoding: "utf8",
    flag: "r",
  });
  featureJSON = JSON.parse(json_remove_ignored(jsonText));
} catch {
  console.error(`Error parsing JSON from ${jsonText}:`, err);
  process.exitCode = 1;
}

const errors = val.validate(featureJSON, schema).errors;
if (errors.length != 0) {
  console.error("Schema Validation Failed. Error(s):");
  errors.forEach((error) => {
    console.error(error.stack);
  });
  process.exitCode = 1;
}

// map namespaces

// list of top-level feature paths (normalized)
// full paths (pack:dir/file)
let featureList = new Set();

let namespace = featureJSON.namespace;
delete featureJSON.namespace;
namespaces[namespace] = {};

for (const key in featureJSON) {
  const path = ref_to_path(key, namespace);
  if (!featureList.has(path)) {
    featureList.add(path);
  }
  namespaces[namespace][path] = featureJSON[key];
}


// define features

function ref_normalize(ref, path, namespace, index=0) {
  if (typeof ref === "string") {
    // convert reference to path
    ref = ref_to_path(ref, namespace);

    // check that referenced feature exists
    if (!featureList.has(ref)) {
      console.error(`Feature ${ref} not found.`);
    }

    return ref;
  } else {
    let child = structuredClone(ref);
    const child_path = `${path}_${index}`;
    if (featureList.has(child_path)) {
      console.error(`Duplicate feature, ${child_path}`);
    } else {
      featureList.add(child_path);
      featureRegistry[child.type].flatten(child, child_path);
    }
    return child_path;
  }
}

const featureRegistry = {
  rule: {
    // flattens the feature tree into a list of features
    flatten: (feature, path) => {
      const [, namespace, name] = path_split(path);
      feature.places = ref_normalize(feature.places, path, namespace);
      feature.description = {
        identifier: path,
        places_feature: structuredClone(feature.places)
      };
      delete feature.type;
      delete feature.places;

      write_path(feature_rules_dir, namespace, name, {
        format_version: "1.13.0",
        "minecraft:feature_rules": feature
      });
    },
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
  },

  scatter: {
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
        "minecraft:scatter_feature": feature
      });
    },
  }
};

// split features into files & convert to correct format

for (const namespace in namespaces) {
  for (const key in namespaces[namespace]) {
    const json = namespaces[namespace][key];
    featureRegistry[json.type].flatten(json, key);
  }
}
