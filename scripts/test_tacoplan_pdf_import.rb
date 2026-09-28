#!/usr/bin/env ruby
# frozen_string_literal: true

require "date"
require "open3"

PDF_PATH = ARGV[0] || "/Users/ejaremtchuk/Downloads/InformeYoussefElOmariyosfbouncyJUNIO.pdf"
SWIFT_SCRIPT = File.expand_path("extract_pdf_text.swift", __dir__)
PAGE_BREAK = "<<<TACOPLAN_PAGE_BREAK>>>"
COUNTRY_RX = /(?:Francia|España|España|Alemania|Polonia|Chequia|República Checa|República Checa)/i

def norm(value)
  value.to_s.gsub(/\s+/, " ").strip
end

def normalize_location(value)
  normalized = value.to_s
    .gsub(/\u00A0/, " ")
    .gsub(/\r?\n+/, " ")
    .gsub(/\s+([.,])/, "\\1")
    .gsub(/([[:alpha:]])\s*-\s*([[:alpha:]])/, "\\1-\\2")
    .gsub(/\s+/, " ")
    .strip

  normalized = normalized.gsub(/([[:alpha:]'’\-])\s*[.,]?\s*(República Checa|República Checa|Francia|España|España|Alemania|Polonia|Chequia)\b/i, "\\1, \\2")
  normalized.gsub(/España/i, "España").gsub(/República/i, "República")
end

def parse_minutes(value)
  match = value.to_s.match(/(\d{1,2})h(?:\s*(\d{1,2})m)?/i)
  return nil unless match

  (match[1].to_i * 60) + match[2].to_i
end

def find_marker(text, markers, from_index = 0)
  slice = text[from_index..] || ""
  best = nil

  markers.each do |marker|
    pattern = marker.split(/\s+/).map { |part| Regexp.escape(part) }.join("\\s+")
    match = Regexp.new(pattern, Regexp::IGNORECASE).match(slice)
    next unless match

    candidate = [from_index + match.begin(0), match[0].length, marker]
    best = candidate if best.nil? || candidate[0] < best[0]
  end

  best
end

def extract_locations(text)
  normalized = normalize_location(text)
  cursor = 0
  items = []

  while (match = COUNTRY_RX.match(normalized, cursor))
    candidate = normalize_location(normalized[cursor...match.end(0)])
    items << candidate unless candidate.empty?
    cursor = match.end(0)
  end

  items
end

def parse_locations(text)
  locations = extract_locations(text)
  locations.length >= 2 ? locations.first(2) : nil
end

def parse_money(value)
  match = value.to_s.gsub(/\s+/, "").match(/([0-9]+(?:[.,][0-9]{1,2})?)/)
  match ? match[1].tr(",", ".").to_f : nil
end

def parse_detail_rows(page1, page2)
  lines = page2.lines.map { |line| norm(line) }.reject(&:empty?)
  first_date_index = lines.find_index { |line| /^\d{2}\/\d{2}\/\d{4}$/.match?(line) }
  detail_rows = []

  if first_date_index
    dates = []
    cursor = first_date_index
    while cursor < lines.length && /^\d{2}\/\d{2}\/\d{4}$/.match?(lines[cursor])
      dates << lines[cursor]
      cursor += 1
    end

    cursor += 1 while cursor < lines.length && (/^\d+$/.match?(lines[cursor]) || lines[cursor].casecmp?("cantidad"))

    routes = lines[cursor..].to_a.select { |line| /\A(?:Nacional|Internacional)\z/i.match?(line) }.first(dates.length)
    diets = lines.select { |line| /\d+%\s*[0-9]+(?:[.,][0-9]{1,2})?\s*€/i.match?(line) }.first(dates.length)
    extra_header_index = lines.find_index { |line| line.casecmp?("extra plus") || (line.downcase.include?("extra") && line.downcase.include?("plus")) }
    total_header_index = lines.find_index.with_index { |line, index| index.to_i > (extra_header_index || -1) && line.casecmp?("total") }
    extras = extra_header_index ? lines[(extra_header_index + 1)..].to_a.select { |line| /^(-|[0-9]+(?:[.,][0-9]{1,2})?\s*€)(\s+(-|[0-9]+(?:[.,][0-9]{1,2})?\s*€))*$/i.match?(line) }.first(dates.length) : []
    totals = total_header_index ? lines[(total_header_index + 1)..].to_a.select { |line| /^[0-9]+(?:[.,][0-9]{1,2})?\s*€$/i.match?(line) }.first(dates.length) : []

    if dates.length.positive? && [routes.length, diets.length, extras.length, totals.length].all? { |size| size == dates.length }
      detail_rows = dates.each_with_index.map do |date, index|
        diet_line = diets[index]
        {
          date: date,
          route: routes[index],
          pct: diet_line[/(\d+)%/, 1].to_i,
          diet: parse_money(diet_line.sub(/^.*?(\d+%)\s*/, "").sub(/^\d+%\s*/, "")),
          extra: parse_money(extras[index]) || 0.0,
          plus: 0.0,
          total: parse_money(totals[index]) || 0.0,
        }
      end
    end
  end

  if detail_rows.empty?
    chunks = norm(page2)
      .split(/(?=\d{2}\/\d{2}\/\d{4}\s)/)
      .map { |chunk| norm(chunk) }
      .select { |chunk| /^\d{2}\/\d{2}\/\d{4}\b/.match?(chunk) }

    detail_rows = chunks.map do |chunk|
      date = chunk[/^(\d{2}\/\d{2}\/\d{4})\b/, 1]
      route = chunk[/\b(Internacional|Nacional)\b/i, 1]
      pct = chunk[/\b(30|60|100)%\b/, 1]&.to_i
      amounts = chunk.scan(/([0-9]+(?:[.,][0-9]{1,2})?)\s*€/i).flatten.map { |value| value.tr(",", ".").to_f }
      next unless date && route && pct && amounts.length >= 2

      {
        date: date,
        route: route,
        pct: pct,
        diet: amounts[0],
        extra: amounts.length >= 3 ? amounts[1] : 0.0,
        plus: 0.0,
        total: amounts[-1],
      }
    end.compact
  end

  extra_hints = page1.scan(/(Domingo|Festivo)\s*\+([0-9]+(?:[.,][0-9]{1,2})?)€/i).map do |kind, amount|
    { type: kind.downcase.include?("dom") ? "DOMINGO" : "FESTIVO", amount: amount.tr(",", ".").to_f }
  end
  detail_rows.select { |row| row[:extra].positive? }.each_with_index do |row, index|
    hint = extra_hints[index]
    row[:flag] = hint && (hint[:amount] - row[:extra]).abs <= 0.011 ? hint[:type] : nil
  end

  detail_rows
end

def build_detail_map(rows)
  rows.each_with_object(Hash.new { |hash, key| hash[key] = [] }) do |row, hash|
    hash[row[:date]] << row
  end
end

def take_detail(detail_map, date, route)
  queue = detail_map[date]
  return nil if queue.nil? || queue.empty?

  if route
    index = queue.find_index { |row| row[:route].casecmp?(route) }
    return queue.delete_at(index) if index
  end

  queue.shift
end

def parse_row(block, detail)
  compact = norm(block.gsub("\n", " "))
  dates = compact.scan(/\d{2}\/\d{2}\/\d{4}/)
  times = compact.scan(/\d{2}:\d{2}/)
  durations = compact.scan(/\d+h(?:\s\d{1,2}m)?/i)
  route = compact[/\b(Internacional|Nacional)\b/i, 1] || detail&.dig(:route)

  location_source = compact.dup
  [dates[0], dates[1], times[0], times[1], durations[0], durations[1]].compact.each do |value|
    location_source = location_source.sub(value, " ")
  end
  location_source = location_source.sub(route, " ") if route
  location_source = location_source
    .gsub(/Domingo\s*\+[0-9.,]+€/i, " ")
    .gsub(/Festivo\s*\+[0-9.,]+€/i, " ")
    .gsub(/Descanso fuera de base sin jornada.*$/i, " ")
    .gsub(/\s*-\s*/, " ")
    .gsub(/República/i, "República")
    .gsub(/España/i, "España")

  locations = parse_locations(location_source.gsub(/República\s+Checa/i, "República Checa"))
  raise "sin origen/destino" unless locations

  {
    date: dates[0],
    time: times[0],
    end_date: dates[1],
    end_time: times[1],
    origin: locations[0],
    destination: locations[1],
    route: route,
    driving: durations[0],
    duration: durations[1],
    pct: detail&.dig(:pct),
    diet: detail&.dig(:diet),
    extra: detail&.dig(:extra),
    plus: detail&.dig(:plus) || 0.0,
    total: detail&.dig(:total),
    flag: detail&.dig(:flag),
  }
end

stdout, stderr, status = Open3.capture3("swift", SWIFT_SCRIPT, PDF_PATH)
abort(stderr.empty? ? "No se pudo extraer el texto del PDF" : stderr) unless status.success?

text = stdout
abort("El PDF no contiene texto") if norm(text).empty?

pages = text.split(PAGE_BREAK).map(&:strip)
page1 = pages[0] || ""
page2 = pages[1] || ""
detail_rows = parse_detail_rows(page1, page2)
detail_map = build_detail_map(detail_rows)

inicio = find_marker(page1, ["INICIO"])
fin = find_marker(page1, ["FIN"], inicio[0] + inicio[1])
origen = find_marker(page1, ["ORIGEN"], fin[0] + fin[1])
destino = find_marker(page1, ["DESTINO"], origen[0] + origen[1])
duracion = find_marker(page1, ["DURACION"], destino[0] + destino[1])
dieta = find_marker(page1, ["DIETA"], duracion[0] + duracion[1])
extra_plus = find_marker(page1, ["EXTRA PLUS"], dieta[0] + dieta[1])
obs = find_marker(page1, ["OBS."], extra_plus[0] + extra_plus[1])

starts = page1[inicio[0] + inicio[1]...fin[0]].scan(/\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}/)
ends = page1[fin[0] + fin[1]...origen[0]].scan(/\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}/)
origins = extract_locations(page1[origen[0] + origen[1]...destino[0]])
destinations = extract_locations(page1[destino[0] + destino[1]...duracion[0]])
durations = page1[duracion[0] + duracion[1]...dieta[0]].scan(/\d{1,2}h(?:\s*\d{1,2}m)?/i)
route_driving = page1[extra_plus[0] + extra_plus[1]...obs[0]]
routes = route_driving.scan(/\b(Internacional|Nacional)\b/i).flatten
driving = route_driving.scan(/\d{1,2}h(?:\s*\d{1,2}m)?/i)

tail = page1[obs[0] + obs[1]..] || ""
tail_end = find_marker(tail, ["TOTALES", "Generado por Tacoplan", "about:blank", "TACOPLAN_DATA:"])
tail_chunk = tail_end ? tail[0...tail_end[0]] : tail
tail_lines = tail_chunk.lines.map { |line| norm(line) }.reject(&:empty?)
first_lower_index = tail_lines.find_index { |line| line == "🛌" || /^\d{2}\/\d{2}\/\d{4}\b/.match?(line) } || tail_lines.length
top_observations = tail_lines[0...first_lower_index]
lower_lines = tail_lines[first_lower_index..] || []

top_rows = starts.each_with_index.map do |start_value, index|
  date = start_value[0, 10]
  detail = take_detail(detail_map, date, routes[index])
  parse_row(
    [start_value, ends[index], origins[index], destinations[index], routes[index], driving[index], durations[index], top_observations[index]].compact.join(" "),
    detail,
  )
end

candidate_blocks = []
current_block = []
lower_lines.each do |line|
  starts_block = line == "🛌" || /^\d{2}\/\d{2}\/\d{4}\b/.match?(line)
  should_keep_special_together = current_block.first == "🛌" && current_block.length == 1 && /^\d{2}\/\d{2}\/\d{4}\b/.match?(line)
  if starts_block && !current_block.empty? && !should_keep_special_together
    candidate_blocks << current_block.join("\n")
    current_block = []
  end
  current_block << line
end
candidate_blocks << current_block.join("\n") unless current_block.empty?

normal_rows = []
special_rows = []
rejected_rows = []

candidate_blocks.each do |block|
  if block.include?("Descanso fuera de base sin jornada")
    special_rows << {
      date: block[/\d{2}\/\d{2}\/\d{4}/],
      note: "Descanso fuera de base sin jornada",
    }
    next
  end

  begin
    date = block[/\d{2}\/\d{2}\/\d{4}/]
    route = block[/\b(Internacional|Nacional)\b/i, 1]
    detail = take_detail(detail_map, date, route)
    normal_rows << parse_row(block, detail)
  rescue => error
    rejected_rows << { block: norm(block)[0, 160], reason: error.message }
  end
end

all_rows = (top_rows + normal_rows).sort_by do |row|
  [Date.strptime(row[:date], "%d/%m/%Y"), row[:time] || "00:00"]
end

driving_total = all_rows.sum { |row| parse_minutes(row[:driving]) || 0 }
duration_total = all_rows.sum { |row| parse_minutes(row[:duration]) || 0 }
diet_total = all_rows.sum { |row| row[:diet].to_f }.round(2)
extra_total = all_rows.sum { |row| row[:extra].to_f }.round(2)
plus_total = all_rows.sum { |row| row[:plus].to_f }.round(2)
overall_total = all_rows.sum { |row| row[:total].to_f }.round(2)

puts "PDF: #{PDF_PATH}"
puts "Paginas: #{pages.length}"
puts "Texto extraido: #{text.length} caracteres"
puts "Primeras 1000 letras:"
puts text[0, 1000]
puts
puts "Fechas detectadas: #{text.scan(/\d{2}\/\d{2}\/\d{4}/).length}"
puts "Bloques candidatos: #{candidate_blocks.length}"
puts "Primer bloque parseado: #{all_rows.first.inspect}"
puts "Ultimo bloque parseado: #{all_rows.last.inspect}"
puts "Jornadas normales: #{all_rows.length}"
puts "Registros especiales: #{special_rows.length}"
puts "Totales calculados:"
puts "  Conduccion: #{driving_total} min"
puts "  Duracion: #{duration_total} min"
puts "  Dietas: #{format('%.2f', diet_total)} EUR"
puts "  Extras: #{format('%.2f', extra_total)} EUR"
puts "  Plus: #{format('%.2f', plus_total)} EUR"
puts "  Total: #{format('%.2f', overall_total)} EUR"
puts "Filas rechazadas: #{rejected_rows.length}"
rejected_rows.each do |row|
  puts "  - #{row[:reason]} | #{row[:block]}"
end

checks = {
  "2026-06-20" => ->(row) {
    raise "20/06 origen incorrecto" unless row[:origin] == "Solaize, Francia"
    raise "20/06 destino incorrecto" unless row[:destination] == "Abrera, España"
    raise "20/06 dieta incorrecta" unless row[:diet] == 72.77
    raise "20/06 porcentaje incorrecto" unless row[:pct] == 100
    raise "20/06 ruta incorrecta" unless row[:route] == "Internacional"
  },
  "2026-06-23" => ->(row) {
    raise "23/06 origen incorrecto" unless row[:origin] == "Abrera, España"
    raise "23/06 destino incorrecto" unless /\AVitoria(?:-| )Gasteiz, España\z/.match?(row[:destination])
    raise "23/06 dieta incorrecta" unless row[:diet] == 54.30
    raise "23/06 porcentaje incorrecto" unless row[:pct] == 100
    raise "23/06 ruta incorrecta" unless row[:route] == "Nacional"
  },
  "2026-06-24" => ->(row) {
    raise "24/06 base incorrecta" unless (row[:diet] - row[:extra]).round(2) == 54.30
    raise "24/06 extra incorrecto" unless row[:extra] == 82.00
    raise "24/06 total incorrecto" unless row[:diet] == 136.30
  },
  "2026-07-02" => ->(row) {
    raise "02/07 origen incorrecto" unless row[:origin] == "Abrera, España"
    raise "02/07 destino incorrecto" unless row[:destination] == "Abrera, España"
    raise "02/07 porcentaje incorrecto" unless row[:pct] == 30
    raise "02/07 dieta incorrecta" unless row[:diet] == 16.29
  },
  "2026-07-03" => ->(row) {
    raise "03/07 porcentaje incorrecto" unless row[:pct] == 60
    raise "03/07 dieta incorrecta" unless row[:diet] == 32.58
  },
  "2026-07-12" => ->(row) {
    raise "12/07 base incorrecta" unless (row[:diet] - row[:extra]).round(2) == 72.77
    raise "12/07 extra incorrecto" unless row[:extra] == 82.38
    raise "12/07 total incorrecto" unless row[:diet] == 155.15
  },
}

checks.each do |date, assertion|
  row = all_rows.find { |item| Date.strptime(item[:date], "%d/%m/%Y").strftime("%Y-%m-%d") == date }
  raise "No se encontró la jornada #{date}" unless row
  assertion.call(row)
end

expected_ok =
  all_rows.length == 19 &&
  special_rows.length == 1 &&
  driving_total == 8169 &&
  duration_total == 11_151 &&
  diet_total == 1495.40 &&
  extra_total == 246.38 &&
  plus_total == 0.0 &&
  overall_total == 1741.78

abort("Resultado inesperado en la prueba del PDF") unless expected_ok
